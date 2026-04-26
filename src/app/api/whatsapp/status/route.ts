import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: settings } = await supabase
    .from('whatsapp_settings')
    .select('instance_id, api_token')
    .eq('user_id', user.id)
    .single();

  if (!settings?.instance_id || !settings?.api_token) {
    return NextResponse.json({ connected: false, error: 'Credentials non configurés' });
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${settings.instance_id}?access_token=${settings.api_token}`
    );
    const json = await res.json();
    const connected = !!json.id && !json.error;

    await supabase
      .from('whatsapp_settings')
      .update({ connected, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);

    return NextResponse.json({ connected, phone: json.display_phone_number || '' });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
