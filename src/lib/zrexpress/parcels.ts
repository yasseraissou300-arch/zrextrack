// Fetch paginé des colis depuis l'API ZRExpress.
// Extrait de src/app/api/sync-zrexpress/route.ts pour éviter un export hors
// des méthodes HTTP dans un route.ts (interdit par Next 15).
// Partagé aussi par /api/campaigns/delivered-customers, /api/autoswap/*.

export const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';

// Garde-fou contre une pagination qui ne se terminerait jamais (API qui
// renverrait toujours hasNext=true). 500 pages × 100 = 50 000 colis, très
// au-dessus des comptes réels (6 354 colis / 64 pages relevés le 2026-09-14).
//
// L'ancien plafond de 50 pages coupait à 5 000 colis : l'API /parcels/search
// n'est PAS triée par date (un colis créé le 10/09 se trouvait page 63), donc
// des colis vivants — dont 3 des 22 swappables — disparaissaient sans erreur.
export const MAX_PARCEL_PAGES = 500;

export async function fetchAllParcels(token: string, tenantId: string): Promise<any[]> {
  const all: any[] = [];
  let pageNumber = 1;
  const pageSize = 100;
  let totalPages = 1;

  while (pageNumber <= totalPages && pageNumber <= MAX_PARCEL_PAGES) {
    const res = await fetch(`${ZREXPRESS_API}/parcels/search`, {
      method: 'POST',
      headers: {
        'X-Api-Key': token,
        'X-Tenant': tenantId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pageNumber, pageSize }),
    });

    if (!res.ok) {
      const text = await res.text();
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

  return all;
}
