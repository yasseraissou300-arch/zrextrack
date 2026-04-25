import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));

  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) {
    return NextResponse.redirect(
      new URL('/ai-chatbot?tab=facebook&error=no_app_id', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
    );
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/ai-chatbot/facebook/callback`;
  const scope = 'pages_messaging,pages_manage_metadata,pages_read_user_content,pages_show_list';
  const state = Buffer.from(JSON.stringify({ user_id: user.id })).toString('base64');

  const fbUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  fbUrl.searchParams.set('client_id', appId);
  fbUrl.searchParams.set('redirect_uri', redirectUri);
  fbUrl.searchParams.set('scope', scope);
  fbUrl.searchParams.set('state', state);
  fbUrl.searchParams.set('response_type', 'code');

  return NextResponse.redirect(fbUrl.toString());
}
