// Webhook de statut Twilio.
// Appelé à plusieurs reprises pendant la vie d'un appel : initiated, ringing,
// answered, completed (avec durée), busy, no-answer, failed, canceled.
// On synchronise voice_calls.status à chaque ping, et au completed on
// calcule la durée + le coût estimé.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { estimateCostDA } from '@/lib/voice-calls/twilio';

export async function POST(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get('cid');
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: true });

  const callStatus = (form.get('CallStatus') as string | null) ?? '';
  const callSid = (form.get('CallSid') as string | null) ?? '';
  const callDuration = parseInt((form.get('CallDuration') as string | null) ?? '0', 10);

  const supabase = createServiceClient();

  const update: Record<string, unknown> = { status: callStatus || null };

  if (callStatus === 'completed' || callStatus === 'busy' || callStatus === 'failed' || callStatus === 'no-answer' || callStatus === 'canceled') {
    update.completed_at = new Date().toISOString();
    if (callDuration > 0) {
      update.duration_seconds = callDuration;
      update.cost_da = estimateCostDA(callDuration);
    }
    // Si Twilio rapporte no-answer / busy / failed sans qu'on ait eu de touche,
    // on enregistre un outcome cohérent.
    if (callStatus === 'no-answer' || callStatus === 'busy') {
      // N'écrase pas un outcome déjà posé par /gather
      const { data: existing } = await supabase
        .from('voice_calls')
        .select('outcome')
        .or(cid ? `id.eq.${cid}` : `twilio_call_sid.eq.${callSid}`)
        .single();
      if (existing && !existing.outcome) update.outcome = 'no_answer';
    } else if (callStatus === 'failed' || callStatus === 'canceled') {
      const { data: existing } = await supabase
        .from('voice_calls')
        .select('outcome')
        .or(cid ? `id.eq.${cid}` : `twilio_call_sid.eq.${callSid}`)
        .single();
      if (existing && !existing.outcome) update.outcome = 'failed';
    }
  }

  // Match par cid (paramètre que nous avons mis dans l'URL) en priorité,
  // sinon fallback sur le CallSid si jamais le param a été perdu.
  const query = supabase.from('voice_calls').update(update);
  if (cid) {
    await query.eq('id', cid);
  } else if (callSid) {
    await query.eq('twilio_call_sid', callSid);
  }

  return NextResponse.json({ ok: true });
}
