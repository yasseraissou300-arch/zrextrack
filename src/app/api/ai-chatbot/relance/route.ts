import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

async function sendWhatsApp(instanceName: string, number: string, text: string): Promise<void> {
  if (!EVOLUTION_URL || !EVOLUTION_KEY) return;
  const cleanNumber = number.replace('@s.whatsapp.net', '').replace('@g.us', '');
  try {
    await fetch(`${EVOLUTION_URL}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
      body: JSON.stringify({ number: cleanNumber, text }),
    });
  } catch { /* non-blocking */ }
}

const RELANCE_MESSAGES: Record<string, string> = {
  auto_confirmation: `Salam 👋 Wach mazal bghiti tkmml commande dyalek? Kolchi 3endna rak, ghir 3tina isem w wilaya w produit 😊`,
  sav: `Salam, wach mazal 3andek mushkil? Hna ready nsa3dek — qul liya shu sir 🙏`,
  tracking: `Salam! Wach tqdar t3tini raqm l-colis dyalek bach nchefu statut? 📦`,
};

// POST — triggered by cron (Vercel Cron, external scheduler, or manual call)
export async function POST(req: NextRequest) {
  // Simple secret check to prevent unauthorized triggers
  const authHeader = req.headers.get('authorization') || '';
  const body = await req.json().catch(() => ({}));
  const secret = body.secret || authHeader.replace('Bearer ', '');

  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  // Find incomplete sessions inactive for 2+ hours, not yet relanced, not handed over
  const { data: staleSessions } = await supabase
    .from('ai_chat_sessions')
    .select('id, user_id, channel, contact_id, template_type, relance_sent')
    .eq('is_complete', false)
    .eq('human_handover', false)
    .eq('relance_sent', false)
    .lt('updated_at', twoHoursAgo)
    .limit(50);

  if (!staleSessions || staleSessions.length === 0) {
    return NextResponse.json({ ok: true, relanced: 0 });
  }

  let relanced = 0;

  for (const session of staleSessions) {
    if (session.channel !== 'whatsapp') continue;

    // Get user's WA instance
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('instance_name, connected')
      .eq('user_id', session.user_id)
      .single();

    if (!instance?.connected) continue;

    const msg = RELANCE_MESSAGES[session.template_type] ?? RELANCE_MESSAGES.auto_confirmation;
    await sendWhatsApp(instance.instance_name, session.contact_id, msg);

    await supabase
      .from('ai_chat_sessions')
      .update({ relance_sent: true, updated_at: new Date().toISOString() })
      .eq('id', session.id);

    relanced++;
  }

  return NextResponse.json({ ok: true, relanced });
}

// GET — manual trigger from dashboard or health check
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const secret = req.nextUrl.searchParams.get('secret') || authHeader.replace('Bearer ', '');
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Re-run the relance logic directly (no body needed)
  const supabase = createServiceClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: staleSessions } = await supabase
    .from('ai_chat_sessions')
    .select('id, user_id, channel, contact_id, template_type, relance_sent')
    .eq('is_complete', false)
    .eq('human_handover', false)
    .eq('relance_sent', false)
    .lt('updated_at', twoHoursAgo)
    .limit(50);

  if (!staleSessions || staleSessions.length === 0) {
    return NextResponse.json({ ok: true, relanced: 0 });
  }

  let relanced = 0;
  for (const session of staleSessions) {
    if (session.channel !== 'whatsapp') continue;
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('instance_name, connected')
      .eq('user_id', session.user_id)
      .single();
    if (!instance?.connected) continue;
    const msg = RELANCE_MESSAGES[session.template_type] ?? RELANCE_MESSAGES.auto_confirmation;
    await sendWhatsApp(instance.instance_name, session.contact_id, msg);
    await supabase.from('ai_chat_sessions').update({ relance_sent: true, updated_at: new Date().toISOString() }).eq('id', session.id);
    relanced++;
  }
  return NextResponse.json({ ok: true, relanced });
}
