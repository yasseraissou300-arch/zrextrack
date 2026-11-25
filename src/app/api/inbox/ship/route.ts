// Envoi d'une commande confirmée à ZRExpress.
//
//   GET  ?id=…       → proposition : wilaya / commune rapprochées, listes, bureaux
//   GET  ?wilaya=…   → communes et bureaux stop desk d'une wilaya
//   POST { id, wilayaId, communeId, deliveryType, hubId?, amount, description, street? }
//                    → crée le colis (RÉEL) chez ZRExpress

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/auth/tenant';
import { isForeignSiteRequest } from '@/lib/security/same-site';
import { getZrCredentials, ZR_NOT_CONFIGURED } from '@/lib/zrexpress/credentials';
import {
  communesOf,
  hubsOf,
  loadZrGeo,
  matchCommune,
  matchWilaya,
  wilayasOf,
  type Territory,
} from '@/lib/zrexpress/territories';
import { shipInboxOrder } from '@/lib/inbox/ship';
import { logActivity } from '@/lib/team/activity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slim = (t: Territory) => ({ id: t.id, name: t.name, nameArabic: t.nameArabic, code: t.code });

export async function GET(request: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const service = createServiceClient();
  const zr = await getZrCredentials(service, ctx.tenantId);
  if (!zr) return NextResponse.json(ZR_NOT_CONFIGURED, { status: 400 });
  const geo = await loadZrGeo(zr);
  if (!geo)
    return NextResponse.json(
      { error: 'Liste des wilayas ZRExpress indisponible' },
      { status: 502 }
    );

  const params = new URL(request.url).searchParams;
  const wilayaParam = params.get('wilaya') ?? '';
  if (wilayaParam) {
    if (!UUID.test(wilayaParam))
      return NextResponse.json({ error: 'Wilaya invalide' }, { status: 400 });
    return NextResponse.json({
      communes: communesOf(geo.territories, wilayaParam).map(slim),
      hubs: hubsOf(geo.hubs, wilayaParam),
    });
  }

  const id = params.get('id') ?? '';
  const { data } = await service
    .schema('autotim')
    .from('inbox_orders')
    .select('id, wilaya, commune, address, product, quantity, price, delivery_type, status')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 });
  const o = data as Record<string, any>;

  const w = matchWilaya(geo.territories, o.wilaya);
  const c = w ? matchCommune(geo.territories, w.id, o.commune || o.address) : null;
  return NextResponse.json({
    wilayas: wilayasOf(geo.territories).map(slim),
    match: { wilayaId: w?.id ?? null, communeId: c?.id ?? null },
    communes: w ? communesOf(geo.territories, w.id).map(slim) : [],
    hubs: w ? hubsOf(geo.hubs, w.id) : [],
    suggestion: {
      deliveryType: o.delivery_type === 'stopdesk' ? 'pickup-point' : 'home',
      amount: Number(o.price) || 0,
      description: `${o.product || 'Commande'}${o.quantity > 1 ? ` × ${o.quantity}` : ''}`,
      street: o.address || '',
    },
  });
}

export async function POST(request: NextRequest) {
  if (isForeignSiteRequest(request))
    return NextResponse.json({ error: 'Requête refusée' }, { status: 403 });
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const service = createServiceClient();
  const zr = await getZrCredentials(service, ctx.tenantId);
  if (!zr) return NextResponse.json(ZR_NOT_CONFIGURED, { status: 400 });

  const r = await shipInboxOrder(
    service,
    ctx.tenantId,
    id,
    {
      wilayaId: String(body.wilayaId ?? ''),
      communeId: String(body.communeId ?? ''),
      deliveryType: body.deliveryType,
      hubId: body.hubId ? String(body.hubId) : null,
      amount: Number(body.amount),
      description: String(body.description ?? ''),
      street: typeof body.street === 'string' ? body.street : undefined,
    },
    zr
  );

  if (!r.ok) {
    const map = {
      invalid: [400, r.message ?? 'Données invalides'],
      not_found: [404, 'Commande introuvable'],
      not_confirmed: [409, 'Seules les commandes confirmées peuvent être envoyées'],
      busy: [409, 'Envoi déjà en cours pour cette commande'],
      zr_error: [502, `ZRExpress a refusé : ${r.message ?? 'erreur inconnue'}`],
    } as const;
    const [status, error] = map[r.reason];
    return NextResponse.json({ error }, { status });
  }
  await logActivity(service, ctx, 'inbox.ship', `Colis créé chez ZRExpress : ${r.tracking}`);
  return NextResponse.json({ ok: true, tracking: r.tracking });
}
