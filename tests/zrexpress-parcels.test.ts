// fetchAllParcels — pagination complète de /parcels/search.
//
// Régression du 2026-09-14 : le plafond de 50 pages coupait à 5 000 colis sur
// 6 354, et comme l'API n'est pas triée par date, 3 des 22 colis swappables
// (dont un créé 4 jours plus tôt, page 63) disparaissaient sans erreur.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAllParcels, MAX_PARCEL_PAGES } from '@/lib/zrexpress/parcels';

function fakeApi(totalCount: number, pageSize = 100) {
  const totalPages = Math.ceil(totalCount / pageSize);
  const calls: number[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const { pageNumber } = JSON.parse(String(init?.body));
    calls.push(pageNumber);
    const start = (pageNumber - 1) * pageSize;
    const n = Math.max(0, Math.min(pageSize, totalCount - start));
    const items = Array.from({ length: n }, (_, i) => ({ id: `p${start + i}` }));
    return new Response(
      JSON.stringify({
        items,
        pageNumber,
        pageSize,
        totalCount,
        totalPages,
        hasPrevious: pageNumber > 1,
        hasNext: pageNumber < totalPages,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchAllParcels', () => {
  it('lit les 64 pages d’un compte de 6 354 colis (plus de plafond à 50)', async () => {
    const { calls } = fakeApi(6354);
    const all = await fetchAllParcels('t', 'tenant');
    expect(all).toHaveLength(6354);
    expect(new Set(all.map((p) => p.id)).size).toBe(6354);
    expect(calls).toHaveLength(64);
    expect(calls[63]).toBe(64);
  });

  it('s’arrête dès que l’API annonce hasNext=false', async () => {
    const { calls } = fakeApi(250);
    const all = await fetchAllParcels('t', 'tenant');
    expect(all).toHaveLength(250);
    expect(calls).toEqual([1, 2, 3]);
  });

  it('respecte le garde-fou MAX_PARCEL_PAGES si l’API prétend ne jamais finir', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const { pageNumber } = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ items: [{ id: `p${pageNumber}` }], totalPages: 10_000, hasNext: true }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const all = await fetchAllParcels('t', 'tenant');
    expect(all).toHaveLength(MAX_PARCEL_PAGES);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PARCEL_PAGES);
  });

  it('dédoublonne un colis qui ressort sur deux pages (ordre API instable)', async () => {
    // Un changement d'état pendant le parcours déplace le colis : il apparaît
    // en fin de page 1 ET en début de page 2.
    const pages = [
      { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], totalPages: 2, hasNext: true },
      { items: [{ id: 'c' }, { id: 'd' }], totalPages: 2, hasNext: false },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const { pageNumber } = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(pages[pageNumber - 1]), { status: 200 });
      })
    );
    const all = await fetchAllParcels('t', 'tenant');
    expect(all.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('remonte une erreur lisible sur réponse non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 }))
    );
    await expect(fetchAllParcels('t', 'tenant')).rejects.toThrow('ZREXpress API error 401');
  });
});
