// Lecture paginée d'une requête PostgREST au-delà du plafond de 1 000 lignes.
//
// Avant : une page après l'autre (8 allers-retours ≈ 14 s pour 7 000
// commandes). Ici : la 1re page renvoie aussi le total (count exact), puis les
// pages restantes partent par lots de `concurrency` en parallèle — borné pour
// ne pas saturer la base (instance Nano : voir l'incident 522 du polling 5 s).
// L'ordre des lignes est conservé (pages concaténées dans l'ordre).

export interface PagedResult<T> {
  rows: T[];
  error: { code?: string; message?: string } | null;
}

type PageQuery<T> = (
  from: number,
  to: number,
  withCount: boolean
) => PromiseLike<{
  data: T[] | null;
  error: { code?: string; message?: string } | null;
  count?: number | null;
}>;

export async function fetchAllPaged<T>(
  query: PageQuery<T>,
  opts: { pageSize?: number; maxRows?: number; concurrency?: number } = {}
): Promise<PagedResult<T>> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 50_000;
  const concurrency = Math.max(1, opts.concurrency ?? 4);

  const firstTo = Math.min(pageSize, maxRows) - 1;
  const first = await query(0, firstTo, true);
  if (first.error) return { rows: [], error: first.error };
  const rows: T[] = [...(first.data ?? [])];

  // Première page incomplète : tout est lu.
  if (rows.length < firstTo + 1) return { rows, error: null };

  // Total connu : on lance exactement les pages restantes, par lots.
  if (typeof first.count === 'number') {
    const total = Math.min(first.count, maxRows);
    const starts: number[] = [];
    for (let from = pageSize; from < total; from += pageSize) starts.push(from);
    for (let i = 0; i < starts.length; i += concurrency) {
      const batch = starts.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((from) => query(from, Math.min(from + pageSize, total) - 1, false))
      );
      for (const r of results) {
        if (r.error) return { rows: [], error: r.error };
        rows.push(...(r.data ?? []));
      }
    }
    return { rows, error: null };
  }

  // Total inconnu : lots parallèles jusqu'à la première page incomplète.
  for (let from = pageSize; from < maxRows; from += pageSize * concurrency) {
    const batch: number[] = [];
    for (let k = 0; k < concurrency && from + k * pageSize < maxRows; k++)
      batch.push(from + k * pageSize);
    const results = await Promise.all(
      batch.map((f) => query(f, Math.min(f + pageSize, maxRows) - 1, false))
    );
    for (const r of results) {
      if (r.error) return { rows: [], error: r.error };
      const data = r.data ?? [];
      rows.push(...data);
      if (data.length < pageSize) return { rows, error: null };
    }
  }
  return { rows, error: null };
}
