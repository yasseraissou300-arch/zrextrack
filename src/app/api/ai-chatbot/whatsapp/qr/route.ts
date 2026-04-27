import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('instance_name, connected')
    .eq('user_id', user.id)
    .single();

  if (!instance) return NextResponse.json({ error: 'Instance non créée. Cliquez sur "Connecter" d\'abord.' }, { status: 404 });
  if (instance.connected) return NextResponse.json({ connected: true });

  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return NextResponse.json({
      error: 'Evolution API non configurée. Ajoutez EVOLUTION_API_URL et EVOLUTION_API_KEY dans les variables Vercel.'
    }, { status: 503 });
  }

  try {
    const res = await fetch(`${EVOLUTION_URL}/instance/connect/${instance.instance_name}`, {
      headers: { apikey: EVOLUTION_KEY },
    });
    if (!res.ok) return NextResponse.json({ error: `Erreur Evolution API (${res.status})` }, { status: 502 });
    const json = await res.json();
    const qr = json.base64 ?? json.qrcode?.base64 ?? null;
    if (!qr) return NextResponse.json({ error: 'QR non reçu depuis Evolution API' }, { status: 502 });
    return NextResponse.json({ qr, connected: false });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
