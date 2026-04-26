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
    return NextResponse.json({ error: 'Entre ton Instance ID et API Token dans l\'onglet Connexion puis Sauvegarder' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://api.green-api.com/waInstance${settings.instance_id}/qr/${settings.api_token}`
    );
    if (!res.ok) {
      return NextResponse.json({ error: `Green API erreur ${res.status} — vérifie ton Instance ID et Token` }, { status: 502 });
    }
    const json = await res.json();
    return NextResponse.json(json);
  } catch {
    return NextResponse.json({ error: 'Impossible de contacter Green API' }, { status: 502 });
  }
}
