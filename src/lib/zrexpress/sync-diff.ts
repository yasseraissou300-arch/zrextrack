// Synchronisation ZRExpress → orders : n'écrire que ce qui a changé (P2-6).
//
// Constat (code, avant ce module) — /api/sync-zrexpress et le handler de file
// zrexpress.sync :
//   1. upsertaient TOUTES les commandes du compte à chaque passage (≈ 5 000
//      pour le tenant pilote, toutes les 5 min, par onglet ouvert), même
//      inchangées. `last_update` recevant l'heure du sync, chaque ligne était
//      réellement réécrite : nouvelles versions de lignes, écritures dans les
//      6 index de `orders`, WAL, bloat — sur une instance Free déjà sujette à
//      des 504.
//   2. détectaient les changements de statut via
//      `.in('tracking_number', <tous les suivis>)` : PostgREST plafonne la
//      réponse à 1 000 lignes (et l'URL porte des milliers de valeurs). Les
//      commandes absentes de la réponse étaient prises pour NOUVELLES → leurs
//      notifications partaient dans pending_notifications : un client pouvait
//      recevoir « votre colis est livré » pour une livraison ancienne.
//
// Ici : lecture COMPLÈTE et paginée de l'existant, comparaison champ à champ,
// écriture des seules lignes nouvelles ou modifiées. Si la lecture échoue, on
// retombe sur l'ancien comportement d'écriture mais on ne notifie RIEN (dans
// le doute, pas de message au client).

import type { createServiceClient } from '@/lib/supabase/server';

type Client = ReturnType<typeof createServiceClient>;

/** Champs métier écrits par le sync et comparés. `last_update` est exclu. */
export const COMPARED_FIELDS = [
  'customer_name',
  'customer_whatsapp',
  'wilaya',
  'product_name',
  'cod',
  'delivery_status',
  'attempts',
] as const;

export type SyncRow = { tracking_number: string };
const field = (row: SyncRow, f: string) => (row as unknown as Record<string, unknown>)[f];
export type ExistingOrder = Record<(typeof COMPARED_FIELDS)[number] | 'tracking_number', unknown>;

const PAGE = 1000;
const MAX_ROWS = 100_000;
const UPSERT_CHUNK = 500;

/**
 * Toutes les commandes existantes du tenant, par numéro de suivi.
 * null si la lecture échoue (l'appelant ne notifie alors rien).
 */
export async function loadExistingOrders(
  supabase: Client,
  userId: string
): Promise<Map<string, ExistingOrder> | null> {
  const map = new Map<string, ExistingOrder>();
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from('orders')
      .select(['tracking_number', ...COMPARED_FIELDS].join(', '))
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return null;
    const rows = (data ?? []) as unknown as ExistingOrder[];
    for (const r of rows) map.set(String(r.tracking_number), r);
    if (rows.length < PAGE) return map;
  }
  return map;
}

const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

export interface OrdersDiff<T extends SyncRow> {
  /** Lignes à écrire : nouvelles ou dont un champ comparé a changé. */
  toWrite: T[];
  created: number;
  updated: number;
  unchanged: number;
}

export function diffOrders<T extends SyncRow>(
  rows: T[],
  existing: Map<string, ExistingOrder>
): OrdersDiff<T> {
  const toWrite: T[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const row of rows) {
    const prev = existing.get(row.tracking_number);
    if (!prev) {
      created++;
      toWrite.push(row);
    } else if (COMPARED_FIELDS.some((f) => !same(prev[f], field(row, f)))) {
      updated++;
      toWrite.push(row);
    } else {
      unchanged++;
    }
  }
  return { toWrite, created, updated, unchanged };
}

/**
 * Statut à notifier ? Seulement si l'existant est CONNU (lecture réussie) et
 * que le statut diffère (ou que la commande est réellement nouvelle).
 */
export function statusChanged(existing: Map<string, ExistingOrder> | null, row: SyncRow): boolean {
  if (existing === null) return false; // lecture échouée : dans le doute, rien
  const prev = existing.get(row.tracking_number);
  return !prev || !same(prev.delivery_status, field(row, 'delivery_status'));
}

/** Upsert par paquets (onConflict user_id, tracking_number). */
export async function upsertOrdersInChunks(
  supabase: Client,
  rows: SyncRow[]
): Promise<{ written: number; error: { message: string } | null }> {
  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from('orders')
      .upsert(chunk, { onConflict: 'user_id,tracking_number' });
    if (error) return { written, error };
    written += chunk.length;
  }
  return { written, error: null };
}
