// Wilayas, communes et bureaux (stop desk) ZRExpress — nécessaires pour créer
// un colis (POST /parcels attend des identifiants de territoire, pas des noms).
//
// Le Google Sheet du marchand contient du texte libre (« Oran », « 31 »,
// « 31 - Oran », « وهران », « Bir el djir ») : on charge toute la liste une
// fois (≈ 1 600 territoires, mise en cache par instance) et on rapproche
// localement. En cas de doute, le marchand choisit dans une liste.

import { ZREXPRESS_API } from '@/lib/zrexpress/parcels';

export interface ZrAuth {
  token: string;
  tenantId: string;
}

export interface Territory {
  id: string;
  code: number | null;
  name: string;
  nameArabic: string;
  parentId: string | null;
  hasHomeDelivery: boolean;
  hasPickupPoint: boolean;
}

export interface PickupHub {
  id: string;
  name: string;
  street: string;
  cityTerritoryId: string;
  phone: string;
}

const TTL_MS = 6 * 3600 * 1000;
const cache = new Map<string, { at: number; territories: Territory[]; hubs: PickupHub[] }>();

export function __resetTerritoryCache(): void {
  cache.clear();
}

const headers = (a: ZrAuth) => ({
  'Content-Type': 'application/json',
  'X-Api-Key': a.token,
  'X-Tenant': a.tenantId,
});

async function searchAll<T>(
  auth: ZrAuth,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<T[] | null> {
  const out: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetchImpl(`${ZREXPRESS_API}${path}`, {
      method: 'POST',
      headers: headers(auth),
      body: JSON.stringify({ ...body, pageNumber: page, pageSize: 1000 }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: T[]; hasNext?: boolean };
    out.push(...(json.items ?? []));
    if (!json.hasNext) break;
  }
  return out;
}

/** Territoires + bureaux stop desk du compte ZR (cache 6 h). null si ZR refuse. */
export async function loadZrGeo(
  auth: ZrAuth,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now()
): Promise<{ territories: Territory[]; hubs: PickupHub[] } | null> {
  const hit = cache.get(auth.tenantId);
  if (hit && now - hit.at < TTL_MS) return hit;
  try {
    const [rawT, rawH] = await Promise.all([
      searchAll<any>(auth, '/territories/search', { includeUnavailable: false }, fetchImpl),
      searchAll<any>(auth, '/hubs/search', { includeServices: false }, fetchImpl),
    ]);
    if (!rawT) return null;
    const territories: Territory[] = rawT.map((t) => ({
      id: String(t.id),
      code: Number.isFinite(Number(t.code)) ? Number(t.code) : null,
      name: String(t.name ?? ''),
      nameArabic: String(t.nameArabic ?? ''),
      parentId: t.parentId ? String(t.parentId) : null,
      hasHomeDelivery: t.delivery?.hasHomeDelivery !== false,
      hasPickupPoint: !!t.delivery?.hasPickupPoint,
    }));
    const hubs: PickupHub[] = (rawH ?? [])
      .filter((h) => h.isPickupPoint && h.isVisible !== false && h.address?.cityTerritoryId)
      .map((h) => ({
        id: String(h.id),
        name: String(h.name ?? ''),
        street: String(h.address?.street ?? ''),
        cityTerritoryId: String(h.address.cityTerritoryId),
        phone: String(h.phone?.number1 ?? ''),
      }));
    const entry = { at: now, territories, hubs };
    cache.set(auth.tenantId, entry);
    return entry;
  } catch {
    return null;
  }
}

// ── Rapprochement texte libre → territoire ───────────────────────────────────

export function normPlace(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(wilaya|commune|ولاية|بلدية)\s+(de\s+|d')?/, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .replace(/\b(el|al)\s+/g, 'el')
    .replace(/^ال/, '')
    .trim();
}

/** Wilayas = territoires parents d'au moins une commune (ou sans parent). */
export function wilayasOf(all: Territory[]): Territory[] {
  const parents = new Set(all.map((t) => t.parentId).filter(Boolean));
  return all
    .filter((t) => parents.has(t.id) || !t.parentId)
    .sort((a, b) => (a.code ?? 99) - (b.code ?? 99) || a.name.localeCompare(b.name));
}

export function communesOf(all: Territory[], wilayaId: string): Territory[] {
  return all.filter((t) => t.parentId === wilayaId).sort((a, b) => a.name.localeCompare(b.name));
}

function bestByName(list: Territory[], raw: string): Territory | null {
  const q = normPlace(raw);
  if (!q) return null;
  const names = (t: Territory) => [normPlace(t.name), normPlace(t.nameArabic)].filter(Boolean);
  return (
    list.find((t) => names(t).includes(q)) ??
    list.find((t) => names(t).some((n) => n.length >= 3 && (q.startsWith(n) || n.startsWith(q)))) ??
    list.find((t) => names(t).some((n) => n.length >= 4 && q.includes(n))) ??
    null
  );
}

export function matchWilaya(all: Territory[], raw: string): Territory | null {
  const wilayas = wilayasOf(all);
  const code = String(raw ?? '').match(/\b(\d{1,2})\b/);
  if (code) {
    const byCode = wilayas.find((w) => w.code === Number(code[1]));
    if (byCode) return byCode;
  }
  return bestByName(wilayas, raw);
}

export function matchCommune(all: Territory[], wilayaId: string, raw: string): Territory | null {
  return bestByName(communesOf(all, wilayaId), raw);
}

export function hubsOf(hubs: PickupHub[], wilayaId: string): PickupHub[] {
  return hubs.filter((h) => h.cityTerritoryId === wilayaId);
}
