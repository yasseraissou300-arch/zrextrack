// Repli « lien public » : lecture d'un Sheet partagé « Toute personne
// disposant du lien » quand le compte de service n'est pas configuré.

import { describe, it, expect, vi } from 'vitest';
import { fetchPublicSheetCsv, parseCsv } from '@/lib/inbox/sheet-csv';
import { parseSheet } from '@/lib/inbox/sheet-parse';

describe('parseCsv', () => {
  it('guillemets, virgules et retours à la ligne cités, CRLF', () => {
    const csv =
      'Nom,Téléphone,Adresse\r\n"Ben, Amine",0550123456,"Cité 20 août\nBloc B"\r\nSara,"0661 98 76 54","dit ""El Bahia"""\r\n';
    expect(parseCsv(csv)).toEqual([
      ['Nom', 'Téléphone', 'Adresse'],
      ['Ben, Amine', '0550123456', 'Cité 20 août\nBloc B'],
      ['Sara', '0661 98 76 54', 'dit "El Bahia"'],
    ]);
  });

  it('BOM retiré et dernière ligne sans retour', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseCsv(`${bom}الاسم,رقم الهاتف\nأمين,0550123456`)).toEqual([
      ['الاسم', 'رقم الهاتف'],
      ['أمين', '0550123456'],
    ]);
  });

  it('s’enchaîne avec parseSheet', () => {
    const r = parseSheet(
      parseCsv('الاسم,رقم الهاتف,الولاية,المنتج,السعر\nأمين,0550123456,وهران,Veste,3200\n')
    );
    expect(r.drafts[0]).toMatchObject({
      customer_name: 'أمين',
      phone: '213550123456',
      price: 3200,
    });
  });
});

const csvResponse = (body: string, type = 'text/csv; charset=utf-8', status = 200) =>
  new Response(body, { status, headers: { 'content-type': type } });

describe('fetchPublicSheetCsv', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

  it('Sheet public → lignes', async () => {
    const f = vi.fn(async (_url: string) => csvResponse('Nom,Tel\nA,0550123456\n'));
    expect(await fetchPublicSheetCsv(ID, f as unknown as typeof fetch)).toEqual({
      ok: true,
      values: [
        ['Nom', 'Tel'],
        ['A', '0550123456'],
      ],
    });
    expect(String(f.mock.calls[0][0])).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`
    );
  });

  it('Sheet privé (page de connexion HTML) → no_access', async () => {
    const f = vi.fn(async () => csvResponse('<html>Sign in</html>', 'text/html'));
    expect(await fetchPublicSheetCsv(ID, f as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'no_access',
    });
  });

  it('404 → not_found ; identifiant invalide → aucun appel réseau', async () => {
    const f = vi.fn(async () => csvResponse('', 'text/html', 404));
    expect((await fetchPublicSheetCsv(ID, f as unknown as typeof fetch)).ok).toBe(false);
    const g = vi.fn();
    expect(await fetchPublicSheetCsv('../../evil', g as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(g).not.toHaveBeenCalled();
  });
});
