// Reçoit la touche pressée par le client.
// Twilio POST avec form-data : Digits=1 (confirm) | 2 (cancel) | vide (timeout).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { buildFinalTwiml } from '@/lib/voice-calls/twilio';

export async function POST(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get('cid');
  if (!cid) return xml(`<?xml version="1.0"?><Response><Hangup/></Response>`);

  // Twilio envoie en application/x-www-form-urlencoded
  const form = await req.formData().catch(() => null);
  const digits = (form?.get('Digits') as string | null) ?? '';

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

  await supabase
    .from('voice_calls')
    .update({ outcome })
    .eq('id', cid);

  return xml(buildFinalTwiml(voice, say));
}

function xml(body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}
