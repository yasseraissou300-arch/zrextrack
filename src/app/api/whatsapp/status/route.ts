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
    return NextResponse.json({ stateInstance: 'notAuthorized', connected: false });
  }

  const res = await fetch(
    `https://api.green-api.com/waInstance${settings.instance_id}/getStateInstance/${settings.api_token}`
  );
  const json = await res.json();
  const connected = json.stateInstance === 'authorized';

  await supabase
    .from('whatsapp_settings')
    .update({ connected, updated_at: new Date().toISOString() })
    .eq('user_id', user.id);

  return NextResponse.json({ ...json, connected });
}
