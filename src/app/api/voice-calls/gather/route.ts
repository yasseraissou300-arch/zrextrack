// Reçoit la touche pressée par le client.
// Twilio POST avec form-data : Digits=1 (confirm) | 2 (cancel) | vide (timeout).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { buildFinalTwiml } from '@/lib/voice-calls/twilio';
import { guardTwilioRequest } from '@/lib/security/twilio-guard';

export async function POST(req: NextRequest) {
  // P0-3 : validation de signature Twilio + anti-rejeu.
  // La garde consomme le corps : on utilise guard.params, pas req.formData().
  const guard = await guardTwilioRequest(req, 'webhook.twilio.gather');
  if (!guard.ok) {
    return new NextResponse(`<?xml version="1.0"?><Response><Hangup/></Response>`, {
      status: guard.status,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const cid = guard.callId;
  const digits = guard.params.Digits ?? '';

  const supabase = createServiceClient();
  const { data: call } = await supabase
    .from('voice_calls')
    .select('id, user_id')
    .eq('id', cid)
    .single();

  if (!call) return xml(`<?xml version="1.0"?><Response><Hangup/></Response>`);

  const { data: settings } = await supabase
    .from('voice_call_settings')
    .select('voice, confirm_text, cancel_text, no_answer_text')
    .eq('user_id', call.user_id)
    .single();

  const voice = settings?.voice || 'Polly.Hala-Neural';
  let outcome: 'confirmed' | 'cancelled' | 'no_response' = 'no_response';
  let say = settings?.no_answer_text || 'Smahli, ma fhmtish ljawab. Chokran.';

  if (digits === '1') {
    outcome = 'confirmed';
    say = settings?.confirm_text || 'Chokran! Commande dyalek tta3la9at.';
  } else if (digits === '2') {
    outcome = 'cancelled';
    say = settings?.cancel_text || 'Chokran 3la l-rad. Commande dyalek tatlghat.';
  }

  await supabase.from('voice_calls').update({ outcome }).eq('id', cid);

  return xml(buildFinalTwiml(voice, say));
}

function xml(body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}
