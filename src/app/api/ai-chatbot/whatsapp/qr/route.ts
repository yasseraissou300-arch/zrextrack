import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';

// Allow up to 60s for Evolution API to generate QR (WhatsApp handshake is slow)
export const maxDuration = 60;


// Extract QR (image base64/URL) from any Evolution API response shape.
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
    null
  );
}

// Extract the 8-letter pairing code (e.g., "ABCD-EFGH") if Evolution returned one.
// This is separate from extractQr() because a pairing code is a string the user
// types into WhatsApp, not an image they scan.
function extractPairingCode(json: unknown): string | null {
  const j = json as Record<string, unknown>;
  const code = (j?.pairingCode as string)
    ?? ((j?.qrcode as Record<string, unknown>)?.pairingCode as string)
    ?? null;
  return code || null;
}

// Normalise an Algerian phone number to international format expected by Evolution.
// "0XXXXXXXXX" → "213XXXXXXXXX", "+213..." → "213...", "9-digit" → "213..."
function normalizePhone(raw: string): string {
  const clean = (raw || '').replace(/[\s\-()+.]/g, '');
  if (clean.startsWith('213')) return clean;
  if (clean.startsWith('00213')) return clean.slice(2);
  if (clean.startsWith('0')) return '213' + clean.slice(1);
  if (clean.length === 9) return '213' + clean;
  return clean;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // BYOK : serveur Evolution de l'utilisateur (ou fallback plateforme)
  const { url: EVOLUTION_URL, key: EVOLUTION_KEY } = await resolveEvolutionCreds(user.id);

  const serviceType = req.nextUrl.searchParams.get('service') || 'auto_confirmation';
  const debug = req.nextUrl.searchParams.get('debug') === '1';
  // Si un numéro est fourni, on demande un code de pairing à 8 caractères
  // à entrer dans WhatsApp (au lieu de scanner un QR). Plus pratique quand
  // l'utilisateur est sur le même téléphone que l'app.
  const rawPhone = req.nextUrl.searchParams.get('number') || '';
  const phone = rawPhone ? normalizePhone(rawPhone) : '';
  const wantPairingCode = phone.length >= 11; // 213 + 9 chiffres minimum

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
  const APP_URL_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app';
  const debugLog: Record<string, unknown> = {
    instanceName: instance.instance_name,
    urlPrefix: EVOLUTION_URL.substring(0, 30),
  };

  // Always ensure webhook is configured on this instance (fixes instances created without webhook)
  fetch(`${EVOLUTION_URL}/webhook/set/${instance.instance_name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
    body: JSON.stringify({
      url: `${APP_URL_BASE}/api/ai-chatbot/webhook/whatsapp`,
      webhook_by_events: false,
      webhook_base64: false,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
    }),
  }).catch(() => null); // non-blocking

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

    // 2. Try to get QR (or pairing code if a phone number was provided) from existing instance.
    // Evolution API supports several patterns depending on version :
    //   a) GET /instance/connect/{name}?number=PHONE → returns pairingCode
    //   b) POST /instance/connect/{name} { number: PHONE } → idem
    //   c) POST /instance/pairing-code/{name} { number: PHONE } → dedicated endpoint
    // On essaie chaque format en cascade et on remonte la première réponse exploitable.

    let connectJson: unknown = null;

    if (wantPairingCode) {
      // Format A — GET avec query (le plus répandu)
      const urlA = `${EVOLUTION_URL}/instance/connect/${instance.instance_name}?number=${encodeURIComponent(phone)}`;
      const resA = await fetch(urlA, { headers }).catch(() => null);
      debugLog.attemptA = { url: urlA.replace(EVOLUTION_URL, '<base>'), status: resA?.status ?? 'fetch_failed' };

      let unsupported = false;
      if (resA?.ok) {
        connectJson = await resA.json().catch(() => null);
        debugLog.attemptA_body = connectJson;
        // Cas observé sur Evolution v1.x : la réponse contient `pairingCode: null`
        // EN MÊME TEMPS QU'un QR valide. Signe explicite que la feature n'existe
        // pas dans cette version (au lieu d'absence du champ). Court-circuit.
        const j = connectJson as Record<string, unknown> | null;
        if (j && Object.prototype.hasOwnProperty.call(j, 'pairingCode') && j.pairingCode === null) {
          unsupported = true;
        }
      }

      // Si pas de signal explicite d'incompatibilité, on essaie les autres formats.
      if (!unsupported && !extractPairingCode(connectJson)) {
        // Format B — POST avec body
        const urlB = `${EVOLUTION_URL}/instance/connect/${instance.instance_name}`;
        const resB = await fetch(urlB, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
          body: JSON.stringify({ number: phone }),
        }).catch(() => null);
        debugLog.attemptB = { url: urlB.replace(EVOLUTION_URL, '<base>'), status: resB?.status ?? 'fetch_failed' };
        if (resB?.ok) {
          const bJson = await resB.json().catch(() => null);
          debugLog.attemptB_body = bJson;
          if (extractPairingCode(bJson)) connectJson = bJson;
        }

        // Format C — endpoint dédié pairing-code
        if (!extractPairingCode(connectJson)) {
          const urlC = `${EVOLUTION_URL}/instance/pairing-code/${instance.instance_name}`;
          const resC = await fetch(urlC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
            body: JSON.stringify({ number: phone }),
          }).catch(() => null);
          debugLog.attemptC = { url: urlC.replace(EVOLUTION_URL, '<base>'), status: resC?.status ?? 'fetch_failed' };
          if (resC?.ok) {
            const cJson = await resC.json().catch(() => null);
            debugLog.attemptC_body = cJson;
            if (extractPairingCode(cJson)) connectJson = cJson;
          }
        }
      }

      const pairingCode = extractPairingCode(connectJson);
      if (pairingCode) {
        const formatted = pairingCode.length === 8 && !pairingCode.includes('-')
          ? `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}`
          : pairingCode;
        return NextResponse.json({ pairingCode: formatted, phone, connected: false });
      }

      // Cas attendu : Evolution v1.x renvoie le QR au lieu du code de pairing.
      // On bascule automatiquement et on signale au frontend que la feature
      // n'est pas supportée — sans erreur dure.
      const fallbackQr = extractQr(connectJson);
      if (unsupported || fallbackQr) {
        let qrData: string | null = null;
        if (fallbackQr) {
          if (fallbackQr.startsWith('data:')) qrData = fallbackQr;
          else if (fallbackQr.startsWith('http')) qrData = fallbackQr;
          else qrData = `data:image/png;base64,${fallbackQr}`;
        }
        return NextResponse.json({
          qr: qrData,
          connected: false,
          pairingNotSupported: true,
          notice: 'Cette version d\'Evolution API ne supporte pas le pairing par numéro. Scanne le QR avec ton téléphone.',
        });
      }

      return NextResponse.json({
        error: 'Impossible de joindre Evolution API. Vérifie la configuration côté serveur.',
        debug: debugLog,
      }, { status: 502 });
    }

    // ── Mode QR classique (pas de numéro fourni) ──────────────────────────
    const connectRes = await fetch(
      `${EVOLUTION_URL}/instance/connect/${instance.instance_name}`,
      { headers }
    ).catch(() => null);
    debugLog.connectStatus = connectRes?.status ?? 'fetch_failed';
    connectJson = connectRes?.ok ? await connectRes.json() : null;
    debugLog.connectJson = connectJson;

    let qr = connectJson ? extractQr(connectJson) : null;

    // 3. Instance not found (404) or no QR → create it fresh (no webhook to avoid Evolution API 400 when events array is absent)
    if (!qr) {
      const createBody = {
        instanceName: instance.instance_name,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
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

      // Webhook already set above (non-blocking call at start of function)

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
      // Toujours renvoyer le debug en cas d'échec — c'est précisément quand on en a
      // besoin pour comprendre pourquoi Evolution ne livre pas de QR (instance en
      // état « connecting », session corrompue, etc.).
      return NextResponse.json({
        error: 'QR non disponible. Essaie de réinitialiser cette connexion.',
        debug: debugLog,
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
