import { describe, it, expect } from 'vitest';
import { fetchAllPaged } from '@/lib/supabase/paged';

const table = Array.from({ length: 2500 }, (_, i) => ({ i }));

function fakeQuery(withTotal: boolean) {
  const calls: Array<[number, number]> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const q = async (from: number, to: number, withCount: boolean) => {
    calls.push([from, to]);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return {
      data: table.slice(from, to + 1),
      error: null,
      count: withCount && withTotal ? table.length : null,
    };
  };
  return { q, calls, max: () => maxInFlight };
}

describe('fetchAllPaged', () => {
  it('total connu : toutes les lignes, dans l’ordre, pages en parallèle', async () => {
    const f = fakeQuery(true);
    const r = await fetchAllPaged(f.q, { pageSize: 1000, concurrency: 4 });
    expect(r.error).toBeNull();
    expect(r.rows.map((x) => x.i)).toEqual(table.map((x) => x.i));
    expect(f.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2499],
    ]);
    expect(f.max()).toBe(2);
  });

  it('total inconnu : lit par lots jusqu’à une page incomplète', async () => {
    const f = fakeQuery(false);
    const r = await fetchAllPaged(f.q, { pageSize: 1000, concurrency: 2 });
    expect(r.rows).toHaveLength(2500);
  });

  it('plafond maxRows respecté', async () => {
    const f = fakeQuery(true);
    const r = await fetchAllPaged(f.q, { pageSize: 1000, maxRows: 1500 });
    expect(r.rows).toHaveLength(1500);
  });

  it('erreur sur une page → aucune ligne partielle', async () => {
    const r = await fetchAllPaged(
      async (from) =>
        from === 0
          ? { data: table.slice(0, 1000), error: null, count: 2500 }
          : { data: null, error: { code: 'XX' }, count: null },
      { pageSize: 1000 }
    );
    expect(r.rows).toEqual([]);
    expect(r.error).toEqual({ code: 'XX' });
  });
});
