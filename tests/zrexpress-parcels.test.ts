// fetchAllParcels — pagination complète de /parcels/search.
//
// Régression du 2026-09-14 : le plafond de 50 pages coupait à 5 000 colis sur
// 6 354, et comme l'API n'est pas triée par date, 3 des 22 colis swappables
// (dont un créé 4 jours plus tôt, page 63) disparaissaient sans erreur.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchAllParcels,
  MAX_PARCEL_PAGES,
  PARCEL_ORDER_BY,
  PARCEL_PAGE_SIZE,
} from '@/lib/zrexpress/parcels';

function fakeApi(totalCount: number) {
  const calls: number[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const { pageNumber, pageSize } = JSON.parse(String(init?.body));
    const totalPages = Math.ceil(totalCount / pageSize);
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
  it('lit tout un compte de 6 354 colis par pages de 1 000 (7 requêtes, plus de plafond à 5 000)', async () => {
    const { calls, fetchMock } = fakeApi(6354);
    const all = await fetchAllParcels('t', 'tenant');
    expect(all).toHaveLength(6354);
    expect(new Set(all.map((p) => p.id)).size).toBe(6354);
    expect(calls).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.pageSize).toBe(PARCEL_PAGE_SIZE);
    expect(body.orderBy).toEqual(PARCEL_ORDER_BY); // tri explicite = pagination stable
  });

  it('s’arrête dès que l’API annonce hasNext=false', async () => {
    const { calls } = fakeApi(2500);
    const all = await fetchAllParcels('t', 'tenant');
    expect(all).toHaveLength(2500);
    expect(calls).toEqual([1, 2, 3]);
  });

  it('sur un 429, attend le délai annoncé puis rejoue la même page une fois', async () => {
    const calls: number[] = [];
    let first429 = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const { pageNumber } = JSON.parse(String(init?.body));
        calls.push(pageNumber);
        if (pageNumber === 2 && first429) {
          first429 = false;
          return new Response('{"status":429}', { status: 429, headers: { 'Retry-After': '0' } });
        }
        return new Response(
          JSON.stringify({
            items: [{ id: `p${pageNumber}` }],
            totalPages: 2,
            hasNext: pageNumber < 2,
          }),
          { status: 200 }
        );
      })
    );
    const all = await fetchAllParcels('t', 'tenant');
    expect(all.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(calls).toEqual([1, 2, 2]);
  });

  it('un second 429 remonte un message lisible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('{"status":429}', { status: 429, headers: { 'Retry-After': '0' } })
      )
    );
    await expect(fetchAllParcels('t', 'tenant')).rejects.toThrow('300 requêtes par minute');
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
