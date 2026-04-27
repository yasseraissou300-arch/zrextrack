import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Allow up to 60s for Evolution API to generate QR (WhatsApp handshake is slow)
export const maxDuration = 60;

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';

// Extract base64 QR from any Evolution API response shape
function extractQr(json: any): string | null {
  return (
    json?.qrcode?.base64 ??
    json?.base64 ??
    json?.qr?.base64 ??
    null
  );
}

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

  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return NextResponse.json({
      error: 'Evolution API non configurée. Ajoutez EVOLUTION_API_URL et EVOLUTION_API_KEY dans .env'
    }, { status: 503 });
  }

  const headers = { apikey: EVOLUTION_KEY };

  try {
    // 1. Check if already connected
    const stateRes = await fetch(`${EVOLUTION_URL}/instance/connectionState/${instance.instance_name}`, {
      headers,
    }).catch(() => null);

    if (stateRes?.ok) {
      const stateJson = await stateRes.json();
      const isOpen = stateJson.instance?.state === 'open' || stateJson.state === 'open';
      if (isOpen) {
        // Update DB silently
        createServiceClient()
          .from('whatsapp_instances')
          .update({ connected: true, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
        return NextResponse.json({ connected: true });
      }
    }

    // 2. Try to get QR from existing instance
    const connectRes = await fetch(`${EVOLUTION_URL}/instance/connect/${instance.instance_name}`, {
      headers,
    }).catch(() => null);

    let qr = connectRes?.ok ? extractQr(await connectRes.json()) : null;

    // 3. Instance not found (404) or no QR → create it fresh
    if (!qr) {
      const createRes = await fetch(`${EVOLUTION_URL}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
        body: JSON.stringify({
          instanceName: instance.instance_name,
          token: user.id,
          qrcode: true,
          webhook: `${process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.netlify.app'}/api/ai-chatbot/webhook/whatsapp`,
          webhookByEvents: false,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        }),
      }).catch(() => null);

      // Evolution API v2 returns QR directly in the create response
      if (createRes?.ok) {
        const createJson = await createRes.json();
        qr = extractQr(createJson);
      }

      // If create returned QR, use it; otherwise try connect one more time
      if (!qr) {
        const retryRes = await fetch(`${EVOLUTION_URL}/instance/connect/${instance.instance_name}`, {
          headers,
        }).catch(() => null);
        qr = retryRes?.ok ? extractQr(await retryRes.json()) : null;
      }
    }

    if (!qr) {
      return NextResponse.json({
        error: `QR non disponible. Vérifiez que l'Evolution API est accessible et que les variables EVOLUTION_API_URL / EVOLUTION_API_KEY sont correctes.`
      }, { status: 502 });
    }

    const qrData = qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`;
    return NextResponse.json({ qr: qrData, connected: false });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
