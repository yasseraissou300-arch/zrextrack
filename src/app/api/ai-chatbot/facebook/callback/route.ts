import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { OAUTH_STATE_COOKIE, oauthStateMatches } from '@/lib/security/oauth-state';
import { newVerifyToken, sealPageToken, sealPendingPages } from '@/lib/security/facebook-verify';
import { logEvent } from '@/lib/security/safe-log';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

function redirect(path: string) {
  const res = NextResponse.redirect(new URL(path, APP_URL));
  // Nonce à usage unique : effacé quelle que soit l'issue.
  res.cookies.set(OAUTH_STATE_COOKIE, '', { path: '/api/ai-chatbot/facebook', maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const stateRaw = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !stateRaw) {
    return redirect('/ai-chatbot?tab=facebook&error=denied');
  }

  // 1. Le state doit être celui posé dans CE navigateur au départ de l'OAuth.
  if (!oauthStateMatches(stateRaw, req.cookies.get(OAUTH_STATE_COOKIE)?.value)) {
    logEvent('warn', 'oauth.facebook', { status: 'rejected', reason: 'state_mismatch' });
    return redirect('/ai-chatbot?tab=facebook&error=invalid_state');
  }

  // 2. L'identité vient de la session, jamais du paramètre state.
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return redirect('/login');
  const userId = user.id;

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return redirect('/ai-chatbot?tab=facebook&error=no_app_id');

  const redirectUri = `${APP_URL}/api/ai-chatbot/facebook/callback`;

  // 1. Exchange code → short-lived user token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
  );
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) return redirect('/ai-chatbot?tab=facebook&error=token_exchange');

  // 2. Exchange → long-lived user token
  const longRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenJson.access_token}`
  );
  const longJson = await longRes.json();
  const userToken = longJson.access_token ?? tokenJson.access_token;

  // 3. Get user's pages
  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,picture&access_token=${userToken}`
  );
  const pagesJson = await pagesRes.json();
  const pages: {
    id: string;
    name: string;
    access_token: string;
    picture?: { data: { url: string } };
  }[] = pagesJson.data ?? [];

  if (pages.length === 0) return redirect('/ai-chatbot?tab=facebook&error=no_pages');

  const supabase = createServiceClient();
  // Jeton existant conservé (webhook déjà vérifié chez Meta) ; sinon aléatoire —
  // l'ancien `zrex_fb_<8 car. de l'UUID>` était déductible de l'identifiant.
  const { data: existingConn } = await supabase
    .from('facebook_connections')
    .select('verify_token')
    .eq('user_id', userId)
    .maybeSingle();
  const verify_token: string = existingConn?.verify_token || newVerifyToken();

  if (pages.length === 1) {
    // Auto-connect single page
    const p = pages[0];
    await supabase.from('facebook_connections').upsert(
      {
        user_id: userId,
        page_id: p.id,
        page_name: p.name,
        page_access_token: sealPageToken(userId, p.access_token), // P2-9 : chiffré si trousseau
        page_picture: p.picture?.data?.url ?? '',
        verify_token,
        connected: true,
        pending_pages: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    return redirect('/ai-chatbot?tab=facebook&success=connected');
  }

  // Multiple pages → store list, let user pick
  await supabase.from('facebook_connections').upsert(
    {
      user_id: userId,
      page_id: '',
      page_name: '',
      page_access_token: '',
      page_picture: '',
      verify_token,
      connected: false,
      // Contient le jeton de CHAQUE page : chiffré en bloc (P2-9).
      pending_pages: sealPendingPages(
        userId,
        JSON.stringify(
          pages.map((p) => ({
            id: p.id,
            name: p.name,
            access_token: p.access_token,
            picture: p.picture?.data?.url ?? '',
          }))
        )
      ),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  return redirect('/ai-chatbot?tab=facebook&success=select_page');
}
