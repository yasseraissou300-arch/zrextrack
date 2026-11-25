// Webhook « nouvelle commande » du site du marchand.
//
//   POST /api/inbox/webhook?token=<jeton>
//   Content-Type: application/json
//   { "nom": "…", "telephone": "…", "wilaya": "…", "commune": "…",
//     "produit": "…", "quantite": 1, "prix": 3200, "livraison": "domicile" }
//
// Aussi accepté : tableau de commandes, { orders: [...] }, { data: {...} },
// clés en français / anglais / arabe, objets imbriqués (customer.name…).
// Authentifié par le jeton (identifiant chiffré du marchand) : pas de session.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseWebhookBody, tenantFromToken } from '@/lib/inbox/webhook';
import { insertWebhookOrders } from '@/lib/inbox/store';
import { logEvent } from '@/lib/security/safe-log';

const MAX_BYTES = 200_000;

export async function POST(request: NextRequest) {
  const token =
    new URL(request.url).searchParams.get('token') ?? request.headers.get('x-autotim-token');
  const tenantId = tenantFromToken(token);
  if (!tenantId) return NextResponse.json({ error: 'Jeton invalide' }, { status: 401 });

  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > MAX_BYTES)
    return NextResponse.json({ error: 'Corps vide ou trop volumineux' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const { drafts, received, missing } = parseWebhookBody(body);
  if (!drafts.length) {
    return NextResponse.json(
      {
        error: missing.length
          ? 'Champs « nom » et « téléphone » introuvables (ou téléphone invalide)'
          : 'Aucune commande dans le corps',
        received,
      },
      { status: 422 }
    );
  }

  const r = await insertWebhookOrders(createServiceClient(), tenantId, drafts);
  if (!r.ok) return NextResponse.json({ error: 'Indisponible, réessayez' }, { status: 503 });
  logEvent('info', 'inbox.webhook', {
    tenant_id: tenantId,
    status: 'received',
    reason: `${r.created}/${received}`,
  });
  return NextResponse.json({ ok: true, received, created: r.created });
}
