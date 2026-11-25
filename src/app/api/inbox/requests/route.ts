// Réponses des clients aux questions WhatsApp :
//   GET   : demandes à traiter (report à demain, changement d'adresse) + avis
//   PATCH : { id } → demande traitée

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/auth/tenant';
import { isForeignSiteRequest } from '@/lib/security/same-site';
import {
  ANSWER_LABELS,
  markRequestHandled,
  pendingClientRequests,
  ratingStats,
} from '@/lib/inbox/status-prompts';

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const service = createServiceClient();
  const [requests, ratings] = await Promise.all([
    pendingClientRequests(service, ctx.tenantId),
    ratingStats(service, ctx.tenantId),
  ]);
  if (!requests) return NextResponse.json({ available: false, requests: [], ratings: null });

  // Nom / wilaya / produit depuis la commande (même espace de travail).
  const refs = [...new Set(requests.map((r) => r.ref))];
  const { data: orders } = refs.length
    ? await service
        .from('orders')
        .select('tracking_number, customer_name, wilaya, product_name, cod')
        .eq('user_id', ctx.tenantId)
        .in('tracking_number', refs)
    : { data: [] };
  const byRef = new Map(
    ((orders ?? []) as Record<string, any>[]).map((o) => [String(o.tracking_number), o])
  );

  return NextResponse.json({
    available: true,
    ratings,
    requests: requests.map((r) => {
      const o = byRef.get(r.ref);
      return {
        id: r.id,
        tracking: r.ref,
        phone: r.phone,
        answer: r.answer,
        label: ANSWER_LABELS[r.kind]?.[r.answer] ?? r.answer,
        answered_at: r.answered_at,
        customer_name: o?.customer_name ?? '',
        wilaya: o?.wilaya ?? '',
        product: o?.product_name ?? '',
        cod: o?.cod ?? null,
      };
    }),
  });
}

export async function PATCH(request: NextRequest) {
  if (isForeignSiteRequest(request))
    return NextResponse.json({ error: 'Requête refusée' }, { status: 403 });
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
  const ok = await markRequestHandled(createServiceClient(), ctx.tenantId, id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Demande introuvable ou déjà traitée' }, { status: 404 });
}
