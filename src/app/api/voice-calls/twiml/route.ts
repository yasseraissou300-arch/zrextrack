// Endpoint appelé par Twilio quand le client décroche.
// Twilio fait un POST sur cette URL et attend du TwiML XML en réponse.
// On lit la ligne voice_calls (via ?cid=) pour personnaliser le message.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { buildInitialTwiml, fillTemplate } from '@/lib/voice-calls/twilio';

function appBaseUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, '');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  return `${proto}://${host}`;
}

// Twilio peut envoyer GET ou POST selon la config — on supporte les deux.
async function handle(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get('cid');
  if (!cid) {
    return xml(`<?xml version="1.0"?><Response><Hangup/></Response>`);
  }

  const supabase = createServiceClient();
  const { data: call } = await supabase
    .from('voice_calls')
    .select('id, user_id, customer_name, amount, tracking_number')
    .eq('id', cid)
    .single();

  if (!call) {
    return xml(`<?xml version="1.0"?><Response><Hangup/></Response>`);
  }

  const { data: settings } = await supabase
    .from('voice_call_settings')
    .select('*')
    .eq('user_id', call.user_id)
    .single();

  if (!settings) {
    return xml(`<?xml version="1.0"?><Response><Hangup/></Response>`);
  }

  const message = fillTemplate(settings.message_template, {
    name: call.customer_name,
    amount: call.amount,
    tracking: call.tracking_number,
    shop_name: settings.shop_name,
  });

  const twiml = buildInitialTwiml({
    message,
    voice: settings.voice || 'Polly.Hala-Neural',
    gatherActionUrl: `${appBaseUrl(req)}/api/voice-calls/gather?cid=${cid}`,
    noAnswerText: settings.no_answer_text,
  });
  return xml(twiml);
}

export const GET = handle;
export const POST = handle;

function xml(body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}
