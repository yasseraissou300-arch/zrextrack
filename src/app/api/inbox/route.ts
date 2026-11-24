// Commandes à confirmer (Google Sheet → confirmation → ZRExpress).
//
//   GET   : tableau (par statut) + réglages de la source
//   POST  : { action: 'import' }                → lit les nouvelles lignes du Sheet
//           { action: 'settings', sheet_url, … } → réservé au propriétaire
//   PATCH : { id, status }                       → confirmer / annuler à la main
//
// Propriétaire ET employés (espace de travail résolu par getTenantContext).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/auth/tenant';
import { isForeignSiteRequest } from '@/lib/security/same-site';
import { sheetIdFromUrl } from '@/lib/inbox/sheet-parse';
import {
  getSource,
  importFromSheet,
  listInbox,
  saveSource,
  setInboxStatus,
  type InboxStatus,
} from '@/lib/inbox/store';
import { logActivity } from '@/lib/team/activity';

const IMPORT_MESSAGES: Record<string, string> = {
  no_sheet: 'Ajoutez d’abord le lien de votre Google Sheet',
  no_access: 'Le Sheet n’est pas partagé avec AutoTim (voir l’adresse ci-dessous)',
  not_found: 'Google Sheet introuvable — vérifiez le lien',
  unavailable: 'Google Sheets indisponible pour le moment',
  bad_header: 'Colonnes « nom » et « téléphone » introuvables dans la 1re ligne du Sheet',
};

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const service = createServiceClient();
  const [source, board] = await Promise.all([
    getSource(service, ctx.tenantId),
    listInbox(service, ctx.tenantId),
  ]);
  return NextResponse.json({
    available: source !== null && board !== null,
    role: ctx.role,
    source,
    service_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
    counts: board?.counts ?? {},
    orders: board?.orders ?? [],
  });
}

export async function POST(request: NextRequest) {
  if (isForeignSiteRequest(request))
    return NextResponse.json({ error: 'Requête refusée' }, { status: 403 });
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const service = createServiceClient();

  if (body?.action === 'import') {
    const r = await importFromSheet(service, ctx.tenantId);
    if (!r.ok) {
      return NextResponse.json(
        { error: IMPORT_MESSAGES[r.reason ?? 'unavailable'], reason: r.reason, missing: r.missing },
        { status: r.reason === 'unavailable' ? 503 : 400 }
      );
    }
    return NextResponse.json({ imported: r.imported, skipped: r.skipped, reason: r.reason });
  }

  if (body?.action === 'settings') {
    if (ctx.role !== 'owner')
      return NextResponse.json({ error: 'Réservé au propriétaire du compte' }, { status: 403 });
    const patch: Parameters<typeof saveSource>[2] = {};
    if (body.sheet_url !== undefined) {
      const raw = String(body.sheet_url ?? '').trim();
      const id = raw ? sheetIdFromUrl(raw) : null;
      if (raw && !id)
        return NextResponse.json({ error: 'Lien Google Sheet invalide' }, { status: 400 });
      patch.sheet_id = id;
    }
    if (typeof body.auto_confirm === 'boolean') patch.auto_confirm = body.auto_confirm;
    if (body.confirm_template !== undefined) {
      const t = String(body.confirm_template ?? '').trim();
      if (t.length > 1000)
        return NextResponse.json(
          { error: 'Message trop long (1000 caractères max)' },
          { status: 400 }
        );
      patch.confirm_template = t || null;
    }
    const ok = await saveSource(service, ctx.tenantId, patch);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Enregistrement impossible pour le moment' }, { status: 503 });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}

const LABEL: Partial<Record<InboxStatus, string>> = {
  confirmed: 'confirmée',
  cancelled: 'annulée',
  no_answer: 'sans réponse',
  new: 'remise à confirmer',
};

export async function PATCH(request: NextRequest) {
  if (isForeignSiteRequest(request))
    return NextResponse.json({ error: 'Requête refusée' }, { status: 403 });
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  const status = String(body?.status ?? '') as InboxStatus;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const service = createServiceClient();
  const r = await setInboxStatus(service, ctx.tenantId, id, status);
  if (r === 'forbidden')
    return NextResponse.json({ error: 'Changement de statut impossible' }, { status: 400 });
  if (r === 'not_found')
    return NextResponse.json({ error: 'Commande introuvable ou déjà traitée' }, { status: 404 });
  if (r === 'unavailable')
    return NextResponse.json({ error: 'Indisponible pour le moment' }, { status: 503 });
  await logActivity(service, ctx, 'inbox.status', `Commande ${LABEL[status] ?? status}`);
  return NextResponse.json({ ok: true });
}
