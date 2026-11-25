// Lecture d'un Google Sheet partagé « Toute personne disposant du lien »
// (export CSV public), quand le compte de service de la plateforme n'est pas
// configuré ou n'a pas accès au Sheet.
//
// L'URL est construite ici à partir d'un identifiant validé
// ([A-Za-z0-9_-]{10,100}) : aucun hôte fourni par l'utilisateur.

const SHEET_ID = /^[A-Za-z0-9_-]{10,100}$/;
const MAX_BYTES = 5_000_000;

/** CSV (RFC 4180 : guillemets, guillemets doublés, retours à la ligne cités). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export type CsvResult =
  | { ok: true; values: string[][] }
  | { ok: false; reason: 'no_access' | 'not_found' | 'unavailable' };

export async function fetchPublicSheetCsv(
  sheetId: string,
  fetchImpl: typeof fetch = fetch
): Promise<CsvResult> {
  if (!SHEET_ID.test(sheetId)) return { ok: false, reason: 'not_found' };
  try {
    const res = await fetchImpl(
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`,
      { cache: 'no-store', redirect: 'follow' }
    );
    if (res.status === 404) return { ok: false, reason: 'not_found' };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'no_access' };
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    // Sheet privé : Google renvoie la page de connexion (HTML), pas du CSV.
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/csv')) return { ok: false, reason: 'no_access' };
    const text = await res.text();
    if (text.length > MAX_BYTES) return { ok: false, reason: 'unavailable' };
    return { ok: true, values: parseCsv(text) };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
