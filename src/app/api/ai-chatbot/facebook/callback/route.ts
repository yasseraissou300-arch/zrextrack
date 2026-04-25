import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

function redirect(path: string) {
  return NextResponse.redirect(new URL(path, APP_URL));
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const stateRaw = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !stateRaw) {
    return redirect('/ai-chatbot?tab=facebook&error=denied');
  }

  let userId: string;
  try {
    userId = JSON.parse(Buffer.from(stateRaw, 'base64').toString()).user_id;
  } catch {
    return redirect('/ai-chatbot?tab=facebook&error=invalid_state');
  }

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
  const pages: { id: string; name: string; access_token: string; picture?: { data: { url: string } } }[] =
    pagesJson.data ?? [];

  if (pages.length === 0) return redirect('/ai-chatbot?tab=facebook&error=no_pages');

  const supabase = createServiceClient();
  const verify_token = `zrex_fb_${userId.slice(0, 8)}`;

  if (pages.length === 1) {
    // Auto-connect single page
    const p = pages[0];
    await supabase.from('facebook_connections').upsert(
      {
        user_id: userId,
        page_id: p.id,
        page_name: p.name,
        page_access_token: p.access_token,
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
      pending_pages: JSON.stringify(pages.map(p => ({ id: p.id, name: p.name, access_token: p.access_token, picture: p.picture?.data?.url ?? '' }))),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  return redirect('/ai-chatbot?tab=facebook&success=select_page');
}
