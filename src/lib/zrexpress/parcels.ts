// Fetch paginé des colis depuis l'API ZRExpress.
// Extrait de src/app/api/sync-zrexpress/route.ts pour éviter un export hors
// des méthodes HTTP dans un route.ts (interdit par Next 15).
// Partagé aussi par /api/campaigns/delivered-customers, /api/autoswap/*.

export const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';

// Taille de page : l'API accepte 1 000 (vérifié le 2026-09-19 : 6 403 colis en
// 7 requêtes d'≈1 s). À 100, un compte de ce volume coûtait 64 requêtes par
// lecture, et l'API limite à 300 requêtes par 60 s (en-têtes ratelimit-*) :
// stats + scan + « 7 derniers jours » enchaînés dépassaient la limite → 429.
export const PARCEL_PAGE_SIZE = 1000;

// Tri explicite, sinon la pagination n'est pas stable : sans orderBy, 7 pages
// de 1 000 renvoyaient 6 403 lignes pour 5 842 colis distincts (561 doublons,
// donc 561 colis manqués). Avec createdAt desc + id en départage : 6 403 = 6 403.
// Schéma SearchSupplierParcelsRequest (swagger interne) : orderBy: string[].
export const PARCEL_ORDER_BY = ['createdAt desc', 'id'];

// Garde-fou contre une pagination qui ne se terminerait jamais (API qui
// renverrait toujours hasNext=true). 500 pages × 1 000 = 500 000 colis.
//
// L'ancien plafond de 50 pages × 100 coupait à 5 000 colis : l'API
// /parcels/search n'est PAS triée par date (un colis créé le 10/09 se trouvait
// page 63), donc des colis vivants — dont 3 des 22 swappables — disparaissaient
// sans erreur.
export const MAX_PARCEL_PAGES = 500;

// Attente maximale sur un 429 avant de réessayer UNE fois. L'API annonce la
// fenêtre restante (Retry-After / ratelimit-reset, ≤ 60 s) ; on plafonne pour
// rester sous la durée d'exécution des routes Vercel.
export const RATE_LIMIT_MAX_WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelayMs(res: Response): number {
  const raw = res.headers.get('retry-after') ?? res.headers.get('ratelimit-reset');
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs < 0) return RATE_LIMIT_MAX_WAIT_MS;
  return Math.min(secs * 1000, RATE_LIMIT_MAX_WAIT_MS);
}

export async function fetchAllParcels(token: string, tenantId: string): Promise<any[]> {
  const all: any[] = [];
  let pageNumber = 1;
  const pageSize = PARCEL_PAGE_SIZE;
  let totalPages = 1;
  let rateLimitRetried = false;

  while (pageNumber <= totalPages && pageNumber <= MAX_PARCEL_PAGES) {
    const res = await fetch(`${ZREXPRESS_API}/parcels/search`, {
      method: 'POST',
      headers: {
        'X-Api-Key': token,
        'X-Tenant': tenantId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pageNumber, pageSize, orderBy: PARCEL_ORDER_BY }),
    });

    if (res.status === 429 && !rateLimitRetried) {
      // Fenêtre de 60 s dépassée (autres lectures en parallèle) : on attend
      // la durée annoncée puis on rejoue la MÊME page, une seule fois.
      rateLimitRetried = true;
      await res.text();
      await sleep(retryDelayMs(res));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) {
        throw new Error(
          'ZREXpress limite les lectures à 300 requêtes par minute — réessayez dans une minute'
        );
      }
      throw new Error(`ZREXpress API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();

    if (Array.isArray(data)) {
      all.push(...data);
      break;
    }

    const items = data.content || data.items || data.data || data.parcels || [];
    all.push(...items);

    totalPages = data.totalPages ?? data.total_pages ?? 1;
    if (data.hasNext === false) break; // dernière page annoncée par l'API
    pageNumber++;
  }

  return dedupeById(all);
}

// Ceinture et bretelles : même trié, un colis créé pendant le parcours décale
// les pages suivantes et peut ressortir deux fois (observé le 2026-09-14 sans
// tri : 11 colis swappables en double, 33 comptés pour 22 réels). On garde la
// première occurrence de chaque id.
function dedupeById(parcels: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const p of parcels) {
    const key = p?.id ?? p?.trackingNumber;
    if (key == null) {
      out.push(p);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
