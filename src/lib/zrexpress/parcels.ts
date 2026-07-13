// Fetch paginé des colis depuis l'API ZRExpress.
// Extrait de src/app/api/sync-zrexpress/route.ts pour éviter un export hors
// des méthodes HTTP dans un route.ts (interdit par Next 15).
// Partagé aussi par /api/campaigns/delivered-customers, /api/autoswap/*.

export const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';

export async function fetchAllParcels(token: string, tenantId: string): Promise<any[]> {
  const all: any[] = [];
  let pageNumber = 1;
  const pageSize = 100;
  let totalPages = 1;

  while (pageNumber <= totalPages) {
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
    pageNumber++;
    if (pageNumber > 50) break;
  }

  return all;
}
