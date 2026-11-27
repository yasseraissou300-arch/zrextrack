// Commandes à confirmer : lecture du Google Sheet, stockage, statuts.
// Tables autotim.order_sources / autotim.inbox_orders (migration 011).
// Toutes les requêtes sont scopées sur le tenant (espace de travail).

import type { createServiceClient } from '@/lib/supabase/server';
import { getGoogleAccessToken } from '@/lib/google/service-account';
import { fetchPublicSheetCsv } from '@/lib/inbox/sheet-csv';
import { parseSheet, type InboxDraft, type InboxField } from '@/lib/inbox/sheet-parse';

type Service = ReturnType<typeof createServiceClient>;

export type InboxStatus = 'new' | 'confirming' | 'confirmed' | 'cancelled' | 'no_answer' | 'sent';

export const INBOX_STATUSES: InboxStatus[] = [
  'new',
  'confirming',
  'confirmed',
  'no_answer',
  'cancelled',
  'sent',
];

export interface InboxOrder extends Omit<InboxDraft, 'external_ref'> {
  id: string;
  status: InboxStatus;
  source: string;
  confirm_sent_at: string | null;
  answered_at: string | null;
  zr_tracking: string | null;
  zr_error: string | null;
  created_at: string;
}

export interface OrderSource {
  sheet_id: string | null;
  auto_confirm: boolean;
  confirm_template: string | null;
  last_import_at: string | null;
  last_import_status: string | null;
}

const sources = (s: Service) => s.schema('autotim').from('order_sources');
const inbox = (s: Service) => s.schema('autotim').from('inbox_orders');

const ORDER_COLUMNS =
  'id, status, source, customer_name, phone, wilaya, commune, address, product, quantity, price, ' +
  'delivery_type, note, ordered_at, confirm_sent_at, answered_at, zr_tracking, zr_error, created_at';

/** null = tables absentes (migration 011 non exécutée) ou base indisponible. */
export async function getSource(service: Service, tenantId: string): Promise<OrderSource | null> {
  const { data, error } = await sources(service)
    .select('sheet_id, auto_confirm, confirm_template, last_import_at, last_import_status')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return null;
  return (
    (data as OrderSource | null) ?? {
      sheet_id: null,
      auto_confirm: false,
      confirm_template: null,
      last_import_at: null,
      last_import_status: null,
    }
  );
}

export async function saveSource(
  service: Service,
  tenantId: string,
  patch: Partial<
    Pick<
      OrderSource,
      'sheet_id' | 'auto_confirm' | 'confirm_template' | 'last_import_at' | 'last_import_status'
    >
  >
): Promise<boolean> {
  const { error } = await sources(service).upsert(
    { tenant_id: tenantId, ...patch, updated_at: new Date().toISOString() },
    { onConflict: 'tenant_id' }
  );
  return !error;
}

export type FetchValues = (
  sheetId: string
) => Promise<
  | { ok: true; values: unknown[][] }
  | { ok: false; reason: 'no_access' | 'not_found' | 'unavailable' }
>;

/**
 * Lit l'onglet principal du Sheet :
 *   1. avec le compte de service de la plateforme (Sheet partagé avec lui) ;
 *   2. sinon, export CSV public (Sheet partagé « Toute personne disposant du lien »).
 */
export const fetchSheetValues: FetchValues = async (sheetId) => {
  const token = await getGoogleAccessToken();
  if (token) {
    try {
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/A1:Z2001?majorDimension=ROWS`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      );
      if (res.ok) {
        const json = (await res.json()) as { values?: unknown[][] };
        return { ok: true, values: Array.isArray(json.values) ? json.values : [] };
      }
      if (res.status === 404 || res.status === 400) return { ok: false, reason: 'not_found' };
      // 403 (non partagé avec le compte de service) → on tente le lien public.
    } catch {
      /* repli CSV */
    }
  }
  const csv = await fetchPublicSheetCsv(sheetId);
  return csv.ok ? { ok: true, values: csv.values.slice(0, 2001) } : csv;
};

export interface ImportResult {
  ok: boolean;
  reason?: 'no_sheet' | 'no_access' | 'not_found' | 'unavailable' | 'bad_header' | 'too_soon';
  imported: number;
  skipped: number;
  missing: InboxField[];
}

const MIN_IMPORT_INTERVAL_MS = 60_000;
const RETRY_AFTER_ERROR_MS = 10_000;
const CHUNK = 500;

/** Importe les nouvelles lignes du Sheet. Les commandes déjà connues ne sont jamais réécrites. */
export async function importFromSheet(
  service: Service,
  tenantId: string,
  fetchValues: FetchValues = fetchSheetValues,
  now: number = Date.now()
): Promise<ImportResult> {
  const empty = { imported: 0, skipped: 0, missing: [] as InboxField[] };
  const source = await getSource(service, tenantId);
  if (!source) return { ok: false, reason: 'unavailable', ...empty };
  if (!source.sheet_id) return { ok: false, reason: 'no_sheet', ...empty };
  const last = source.last_import_at ? Date.parse(source.last_import_at) : 0;
  // Après une erreur (Sheet pas encore partagé…), on peut réessayer vite.
  const interval = source.last_import_status?.startsWith('ok')
    ? MIN_IMPORT_INTERVAL_MS
    : RETRY_AFTER_ERROR_MS;
  if (now - last < interval) return { ok: true, reason: 'too_soon', ...empty };

  const fetched = await fetchValues(source.sheet_id);
  const stamp = async (status: string) =>
    sources(service)
      .update({ last_import_at: new Date(now).toISOString(), last_import_status: status })
      .eq('tenant_id', tenantId);

  if (!fetched.ok) {
    await stamp(fetched.reason);
    return { ok: false, reason: fetched.reason, ...empty };
  }
  const parsed = parseSheet(fetched.values);
  if (parsed.missing.length) {
    await stamp('bad_header');
    return { ok: false, reason: 'bad_header', imported: 0, skipped: 0, missing: parsed.missing };
  }

  let imported = 0;
  for (let i = 0; i < parsed.drafts.length; i += CHUNK) {
    const rows = parsed.drafts
      .slice(i, i + CHUNK)
      .map((d) => ({ ...d, tenant_id: tenantId, source: 'sheets', status: 'new' }));
    const { data, error } = await inbox(service)
      .upsert(rows, { onConflict: 'tenant_id,external_ref', ignoreDuplicates: true })
      .select('id');
    if (error) {
      await stamp('unavailable');
      return { ok: false, reason: 'unavailable', imported, skipped: parsed.skipped, missing: [] };
    }
    imported += data?.length ?? 0;
  }
  await stamp(`ok:${imported}`);
  return { ok: true, imported, skipped: parsed.skipped, missing: [] };
}

export interface InboxBoard {
  counts: Record<InboxStatus, number>;
  orders: InboxOrder[];
}

const PER_STATUS = 100;

export async function listInbox(service: Service, tenantId: string): Promise<InboxBoard | null> {
  const results = await Promise.all(
    INBOX_STATUSES.map((status) =>
      inbox(service)
        .select(ORDER_COLUMNS, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(PER_STATUS)
    )
  );
  if (results.some((r) => r.error)) return null;
  const counts = {} as Record<InboxStatus, number>;
  const orders: InboxOrder[] = [];
  INBOX_STATUSES.forEach((status, i) => {
    counts[status] = results[i].count ?? (results[i].data?.length || 0);
    orders.push(...((results[i].data ?? []) as unknown as InboxOrder[]));
  });
  return { counts, orders };
}

/** Changements de statut autorisés à la main (« sent » : uniquement via ZRExpress). */
const MANUAL: Record<string, InboxStatus[]> = {
  confirmed: ['new', 'confirming', 'no_answer', 'cancelled'],
  cancelled: ['new', 'confirming', 'no_answer', 'confirmed'],
  // « Pas de réponse » : après un appel (new) ou une demande WhatsApp (confirming).
  no_answer: ['new', 'confirming'],
  new: ['cancelled', 'no_answer'],
};

export function canMoveTo(from: string, to: string): boolean {
  return (MANUAL[to] ?? []).includes(from as InboxStatus);
}

export async function setInboxStatus(
  service: Service,
  tenantId: string,
  id: string,
  to: InboxStatus
): Promise<'ok' | 'not_found' | 'forbidden' | 'unavailable'> {
  const allowedFrom = MANUAL[to];
  if (!allowedFrom) return 'forbidden';
  const now = new Date().toISOString();
  const { data, error } = await inbox(service)
    .update({ status: to, updated_at: now })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .in('status', allowedFrom)
    .select('id');
  if (error) return 'unavailable';
  return data?.length ? 'ok' : 'not_found';
}

/**
 * Commandes reçues par le webhook du site. Source « manual » (contrainte de la
 * migration 011) et référence préfixée « wh: ». Une commande déjà reçue (même
 * identifiant) n'est jamais réécrite.
 */
export async function insertWebhookOrders(
  service: Service,
  tenantId: string,
  drafts: InboxDraft[]
): Promise<{ ok: boolean; created: number }> {
  if (!drafts.length) return { ok: true, created: 0 };
  const { data, error } = await inbox(service)
    .upsert(
      drafts.map((d) => ({ ...d, tenant_id: tenantId, source: 'manual', status: 'new' })),
      { onConflict: 'tenant_id,external_ref', ignoreDuplicates: true }
    )
    .select('id');
  if (error) return { ok: false, created: 0 };
  return { ok: true, created: data?.length ?? 0 };
}
