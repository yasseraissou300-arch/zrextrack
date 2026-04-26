import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' });

  const supabase = createServiceClient();
  const { data: settings, error: dbError } = await supabase
    .from('whatsapp_settings')
    .select('instance_id, api_token, connected')
    .eq('user_id', user.id)
    .single();

  if (dbError) return NextResponse.json({ step: 'db', error: dbError.message, settings: null });
  if (!settings?.instance_id) return NextResponse.json({ step: 'credentials', error: 'Aucun credentials sauvegardés', settings });

  let greenApiResponse: any = null;
  let greenApiError: string | null = null;
  try {
    const res = await fetch(`https://api.green-api.com/waInstance${settings.instance_id}/qr/${settings.api_token}`);
    greenApiResponse = await res.json();
  } catch (e: any) {
    greenApiError = e.message;
  }

  return NextResponse.json({
    step: 'ok',
    instance_id: settings.instance_id,
    has_token: !!settings.api_token,
    greenApiResponse,
    greenApiError,
  });
}
