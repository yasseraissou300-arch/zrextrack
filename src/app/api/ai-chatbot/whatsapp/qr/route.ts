import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Allow up to 60s for Evolution API to generate QR (WhatsApp handshake is slow)
export const maxDuration = 60;

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';

// Extract QR from any Evolution API response shape (handles string, object, URL, base64)
function extractQr(json: unknown): string | null {
  const j = json as Record<string, unknown>;
  const qrcode = j?.qrcode;
  // qrcode can be a string (the base64/URL directly) or an object with .base64
  const fromQrcode = typeof qrcode === 'string'
    ? qrcode
    : (qrcode as Record<string, string>)?.base64 ?? null;
  return (
    fromQrcode ??
    (j?.base64 as string) ??
    (typeof j?.qr === 'string' ? (j.qr as string) : null) ??
    (j?.qr as Record<string, string>)?.base64 ??
    (j?.pairingCode as string) ??
    null
  );
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const serviceType = req.nextUrl.searchParams.get('service') || 'auto_confirmation';
  const debug = req.nextUrl.searchParams.get('debug') === '1';

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('instance_name, connected')
    .eq('user_id', user.id)
    .eq('service_type', serviceType)
    .single();

  if (!instance) {
    return NextResponse.json(
      { error: 'Instance non créée. Cliquez sur "Lier le numéro" d\'abord.' },
      { status: 404 }
    );
  }

  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return NextResponse.json({
      error: 'Evolution API non configurée. Ajoutez EVOLUTION_API_URL et EVOLUTION_API_KEY dans Vercel.',
      debug: { urlSet: !!EVOLUTION_URL, keySet: !!EVOLUTION_KEY },
    }, { status: 503 });
  }

  const headers = { apikey: EVOLUTION_KEY };
  const debugLog: Record<string, unknown> = {
    instanceName: instance.instance_name,
    urlPrefix: EVOLUTION_URL.substring(0, 30),
  };

  try {
    // 1. Check if already connected
    const stateRes = await fetch(
      `${EVOLUTION_URL}/instance/connectionState/${instance.instance_name}`,
      { headers }
    ).catch(() => null);

    debugLog.stateStatus = stateRes?.status ?? 'fetch_failed';

    if (stateRes?.ok) {
      const stateJson = await stateRes.json();
      debugLog.stateJson = stateJson;
      const isOpen = stateJson.instance?.state === 'open' || stateJson.state === 'open';
      if (isOpen) {
        createServiceClient()
          .from('whatsapp_instances')
          .update({ connected: true, updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('service_type', serviceType);
        return NextResponse.json({ connected: true });
      }
    }

    // 2. Try to get QR from existing instance
    const connectRes = await fetch(
      `${EVOLUTION_URL}/instance/connect/${instance.instance_name}`,
      { headers }
    ).catch(() => null);

    debugLog.connectStatus = connectRes?.status ?? 'fetch_failed';
    const connectJson = connectRes?.ok ? await connectRes.json() : null;
    debugLog.connectJson = connectJson;
    let qr = connectJson ? extractQr(connectJson) : null;

    // 3. Instance not found (404) or no QR → create it fresh
    if (!qr) {
      const createBody = {
        instanceName: instance.instance_name,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        webhook: `${process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app'}/api/ai-chatbot/webhook/whatsapp`,
      };

      const createRes = await fetch(`${EVOLUTION_URL}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
        body: JSON.stringify(createBody),
      }).catch(() => null);

      debugLog.createStatus = createRes?.status ?? 'fetch_failed';
      const createJson = createRes?.ok ? await createRes.json() : null;
      if (!createRes?.ok) {
        const errText = await createRes?.text().catch(() => '');
        debugLog.createError = errText;
      }
      debugLog.createJson = createJson;

      if (createJson) qr = extractQr(createJson);

      if (!qr) {
        const retryRes = await fetch(
          `${EVOLUTION_URL}/instance/connect/${instance.instance_name}`,
          { headers }
        ).catch(() => null);
        debugLog.retryStatus = retryRes?.status ?? 'fetch_failed';
        const retryJson = retryRes?.ok ? await retryRes.json() : null;
        debugLog.retryJson = retryJson;
        qr = retryJson ? extractQr(retryJson) : null;
      }
    }

    if (!qr) {
      return NextResponse.json({
        error: 'QR non disponible.',
        ...(debug ? { debug: debugLog } : {}),
      }, { status: 502 });
    }

    // Normalise QR: can be a data URL, a http URL, or raw base64
    let qrData: string;
    if (qr.startsWith('data:')) {
      qrData = qr; // already a data URL
    } else if (qr.startsWith('http://') || qr.startsWith('https://')) {
      qrData = qr; // use URL directly — Evolution API sometimes returns an image URL
    } else {
      qrData = `data:image/png;base64,${qr}`; // raw base64 — add prefix
    }
    return NextResponse.json({ qr: qrData, connected: false });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message, debug: debugLog }, { status: 502 });
  }
    }
