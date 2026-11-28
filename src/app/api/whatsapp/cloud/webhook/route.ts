// Webhook WhatsApp OFFICIEL (Meta Cloud API).
//
//   GET  : validation de l'URL par Meta (hub.verify_token → hub.challenge)
//   POST : messages entrants — un bouton pressé (« نأكّد », « غدوة »…) ou une
//          réponse « 1 / 2 / 3 » est appliquée à la question ouverte
//          (confirmation, jour de livraison, avis) ; accusé au client.
//
// Authentifié par la signature Meta (X-Hub-Signature-256, secret de l'app).
// Répond toujours 200 à un message signé (sinon Meta le renvoie en boucle).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { cloudConfig, inboundMessages, sendCloudText, validSignature } from '@/lib/whatsapp/cloud';
import { handlePromptReply } from '@/lib/inbox/confirm';
import { logWaMessage } from '@/lib/inbox/wa-sender';
import { isReplayDurable } from '@/lib/security/replay-store';
import { logEvent } from '@/lib/security/safe-log';

export async function GET(request: NextRequest) {
  const cfg = cloudConfig();
  const p = new URL(request.url).searchParams;
  if (
    cfg?.verifyToken &&
    p.get('hub.mode') === 'subscribe' &&
    p.get('hub.verify_token') === cfg.verifyToken
  ) {
    return new NextResponse(p.get('hub.challenge') ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const cfg = cloudConfig();
  if (!cfg) return NextResponse.json({ error: 'Non configuré' }, { status: 404 });
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get('x-hub-signature-256'), cfg.appSecret)) {
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const service = createServiceClient();
  for (const m of inboundMessages(body)) {
    if (m.phoneId && m.phoneId !== cfg.phoneId) continue;
    if (await isReplayDurable(service, `wac:${m.id}`)) continue;

    // Phase 1 : quelques comptes seulement ; la question ouverte du numéro
    // indique à quel compte la réponse appartient.
    for (const tenantId of cfg.tenants) {
      const outcome = await handlePromptReply(service, tenantId, m.from, m.text).catch(() => ({
        handled: false as const,
      }));
      if (!outcome.handled) continue;
      if ('reply' in outcome && outcome.reply) {
        const sent = await sendCloudText(cfg, m.from, outcome.reply);
        if (sent.ok)
          await logWaMessage(
            service,
            tenantId,
            `REPONSE-${outcome.kind}`,
            '',
            m.from,
            outcome.reply
          ).catch(() => {});
      }
      logEvent('info', 'whatsapp.cloud', {
        tenant_id: tenantId,
        status: 'prompt_answered',
        reason: `${'kind' in outcome ? outcome.kind : ''}:${'answer' in outcome ? outcome.answer : ''}`,
      });
      break;
    }
  }
  return NextResponse.json({ ok: true });
}
