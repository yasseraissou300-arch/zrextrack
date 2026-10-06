// P4 — AUDIT (constat, aucun code modifié) : chemins non canoniques dans
// DELETE /api/campaigns/media/upload?path=… (bucket campaign-media).
//
// Garde actuelle : path.startsWith(`${user.id}/`) puis
// service.storage.from(BUCKET).remove([path]) avec le client service-role.
// Ici : VRAI client supabase-js / storage-js 2.103.1, transport capturé — on
// observe la requête EXACTE envoyée au serveur Storage. Le comportement du
// SERVEUR Storage (résolution ou non de « .. ») n'est PAS observable sans un
// Storage réel : ces tests prouvent ce que l'application ACCEPTE et ENVOIE,
// pas ce que le serveur supprime.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient as createSupabase } from '@supabase/supabase-js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

type Sent = { method: string; url: string; body: unknown };
let sent: Sent[] = [];
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  sent.push({
    method: (init?.method ?? 'GET').toUpperCase(),
    url: String(input),
    body: init?.body ? JSON.parse(String(init.body)) : null,
  });
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
});

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () =>
    createSupabase('http://storage.test', 'service-role-test-key', {
      global: { fetch: transport as unknown as typeof fetch },
      auth: { persistSession: false },
    }),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: A } } }) },
  }),
}));

/** `rawQuery` est inséré TEL QUEL dans l'URL (pour tester les encodages). */
async function del(rawQuery: string) {
  const { DELETE } = await import('@/app/api/campaigns/media/upload/route');
  const res = await DELETE(
    new NextRequest(`https://app.test/api/campaigns/media/upload?path=${rawQuery}`, {
      method: 'DELETE',
    })
  );
  return res.status;
}
const enc = encodeURIComponent;

beforeEach(() => {
  sent = [];
  transport.mockClear();
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => vi.restoreAllMocks());

describe('DELETE /api/campaigns/media/upload — garde startsWith(`${user.id}/`)', () => {
  it('1. chemin normal du tenant → accepté, chemin envoyé tel quel', async () => {
    expect(await del(enc(`${A}/1700000000-abc123.png`))).toBe(200);
    expect(sent).toEqual([
      {
        method: 'DELETE',
        url: 'http://storage.test/storage/v1/object/campaign-media',
        body: { prefixes: [`${A}/1700000000-abc123.png`] },
      },
    ]);
  });

  it.each([
    ['../ en tête', `../${B}/x.png`],
    ['../../ en tête', `../../${B}/x.png`],
    ['chemin de B', `${B}/x.png`],
    ['slash initial', `/${A}/x.png`],
    ['préfixe proche (id sans slash)', `${A}x/x.png`],
  ])('%s → REFUSÉ (403), aucun appel Storage', async (_l, p) => {
    expect(await del(enc(p))).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ['A/../B/x', `${A}/../${B}/x.png`],
    ['A/../../B/x', `${A}/../../${B}/x.png`],
    ['A/foo/../bar', `${A}/foo/../bar.png`],
    ['A//x (double slash)', `${A}//x.png`],
    ['A/..\\B\\x (antislash)', `${A}/..\\${B}\\x.png`],
  ])(
    'CONSTAT %s → ACCEPTÉ par la garde, envoyé LITTÉRALEMENT (aucune normalisation client)',
    async (_l, p) => {
      expect(await del(enc(p))).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0].body).toEqual({ prefixes: [p] });
    }
  );

  it('encodage simple %2e%2e%2f : décodé par l’URL avant la garde → « A/../B/x » accepté, envoyé littéralement', async () => {
    expect(await del(`${A}/%2e%2e%2f${B}/x.png`)).toBe(200);
    expect(sent[0].body).toEqual({ prefixes: [`${A}/../${B}/x.png`] });
  });

  it('double encodage %252e%252e : reste « %2e%2e » littéral jusqu’au serveur Storage', async () => {
    expect(await del(`${A}/%252e%252e%252f${B}/x.png`)).toBe(200);
    expect(sent[0].body).toEqual({ prefixes: [`${A}/%2e%2e%2f${B}/x.png`] });
  });

  it('tenant A et chemin réel de B : refusé sans « .. » ; seul « A/../B/… » franchit la garde', async () => {
    expect(await del(enc(`${B}/1700000000-abc123.png`))).toBe(403);
    expect(await del(enc(`${A}/../${B}/1700000000-abc123.png`))).toBe(200);
    expect(sent.map((s) => (s.body as { prefixes: string[] }).prefixes[0])).toEqual([
      `${A}/../${B}/1700000000-abc123.png`,
    ]);
  });
});
