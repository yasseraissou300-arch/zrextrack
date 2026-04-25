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

  if (!instance) return NextResponse.json({ error: 'Instance non créée. Initialisez d\'abord.' }, { status: 404 });
  if (instance.connected) return NextResponse.json({ connected: true });

  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return NextResponse.json({ error: 'Evolution API non configurée (EVOLUTION_API_URL, EVOLUTION_API_KEY)' }, { status: 503 });
  }

  try {
    const res = await fetch(`${EVOLUTION_URL}/instance/connect/${instance.instance_name}`, {
      headers: { apikey: EVOLUTION_KEY },
    });
    if (!res.ok) return NextResponse.json({ error: 'Erreur Evolution API' }, { status: 502 });
    const json = await res.json();
    return NextResponse.json({ qr: json.base64 ?? json.qrcode?.base64 ?? null, connected: false });
  } catch {
    return NextResponse.json({ error: 'Connexion à Evolution API impossible' }, { status: 502 });
  }
}
