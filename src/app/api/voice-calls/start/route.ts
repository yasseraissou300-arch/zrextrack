// Initie un appel sortant via Twilio.
// Crée la ligne voice_calls en DB AVANT l'appel pour pouvoir suivre l'évolution.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getSettings, isReadyToCall, toE164, placeCall } from '@/lib/voice-calls/twilio';

function appBaseUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, '');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { tracking, customer_name, customer_phone, amount } = body as {
    tracking?: string; customer_name?: string; customer_phone?: string; amount?: number;
  };

  if (!customer_phone) return NextResponse.json({ error: 'customer_phone manquant' }, { status: 400 });

  const settings = await getSettings(user.id);
  const ready = isReadyToCall(settings);
  if (!ready.ok) {
    return NextResponse.json({
      error: ready.reason,
      code: 'NOT_CONFIGURED',
      hint: 'Configure Twilio dans /voice-calls onglet Connexion d\'abord.',
    }, { status: 400 });
  }

  const to = toE164(customer_phone);
  const supabase = createServiceClient();

  // 1. Insère la ligne en DB AVANT pour avoir un id stable
  const { data: row, error: insErr } = await supabase
    .from('voice_calls')
    .insert({
      user_id: user.id,
      tracking_number: tracking || '',
      customer_name: customer_name || '',
      customer_phone: to,
      amount: amount ?? null,
      status: 'queued',
    })
    .select('id')
    .single();

  if (insErr || !row) {
    return NextResponse.json({ error: insErr?.message || 'DB insert échoué' }, { status: 500 });
  }

  // 2. Construis les URLs webhook que Twilio va appeler — elles incluent l'id
  // de la ligne pour qu'on retrouve la trace au retour.
  const base = appBaseUrl(req);
  const twimlUrl = `${base}/api/voice-calls/twiml?cid=${row.id}`;
  const statusUrl = `${base}/api/voice-calls/status?cid=${row.id}`;

  // 3. Appelle Twilio
  const result = await placeCall({
    accountSid: settings!.account_sid!,
    authToken: settings!.auth_token!,
    from: settings!.from_number!,
    to,
    twimlUrl,
    statusCallbackUrl: statusUrl,
  });

  if (!result.ok) {
    await supabase
      .from('voice_calls')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', row.id);
    return NextResponse.json({ error: result.error || 'Twilio refuse l\'appel' }, { status: 502 });
  }

  // 4. Sauvegarde le SID Twilio pour pouvoir corréler les webhooks
  await supabase
    .from('voice_calls')
    .update({ twilio_call_sid: result.callSid, status: 'initiated' })
    .eq('id', row.id);

  return NextResponse.json({ ok: true, id: row.id, callSid: result.callSid });
}
