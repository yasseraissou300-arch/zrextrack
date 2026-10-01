// Audit d'authentification — POST /api/autoswap/preview et /api/autoswap/diagnostic.
//
// Le middleware laisse passer tout /api/ : chaque route doit authentifier
// elle-même. Sur main (9c2b249), les deux routes acceptaient un appel ANONYME
// et relayaient vers ZRExpress la clé et le tenant fournis dans le corps
// (relais ouvert). Corrigé par P2-9 phase 1 (cca0b0a, p2-zr-token-server-side) :
// session obligatoire, identifiants ZR lus en base pour l'utilisateur de la
// session. Ce fichier verrouille les cas A à E et l'absence d'effet de bord.
//
// Données synthétiques uniquement (clés, tenants, colis factices).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
let auth: { user: { id: string } | null; error: { message: string } | null } = {
  user: null,
  error: null,
};

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.error }) },
  }),
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const KEY: Record<string, string> = { [A]: 'zr-key-tenant-A-0001', [B]: 'zr-key-tenant-B-0002' };
const ZR_TENANT: Record<string, string> = { [A]: 'zr-tenant-A', [B]: 'zr-tenant-B' };
const A_SECRET_PARCEL = 'COLIS-PRIVE-DU-TENANT-A';

const zrCalls: Array<{ url: string; method: string; key: string | null; tenant: string | null }> =
  [];
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const h = new Headers(init?.headers);
  zrCalls.push({
    url: String(input),
    method: init?.method ?? 'GET',
    key: h.get('x-api-key'),
    tenant: h.get('x-tenant'),
  });
  // ZRExpress factice : le tenant A possède un colis identifiable.
  const items =
    h.get('x-api-key') === KEY[A]
      ? [{ id: 'a1', trackingNumber: A_SECRET_PARCEL, state: { name: 'x' } }]
      : [];
  return Response.json({ items, totalPages: 1, hasNext: false });
});

function configure(user: string) {
  db.seed('public', 'user_sync_settings', [
    {
      user_id: user,
      zrexpress_token: KEY[user],
      zrexpress_tenant_id: ZR_TENANT[user],
      templates: {},
    },
  ]);
  db.seed('public', 'autoswap_size_equivalences', [
    { user_id: user, product_key: `produit-${user.slice(0, 1)}`, groups: [['S', 'M']] },
  ]);
}

const ROUTES = [
  ['preview', '@/app/api/autoswap/preview/route'],
  ['diagnostic', '@/app/api/autoswap/diagnostic/route'],
] as const;

async function call(path: string, body: Record<string, unknown> = {}) {
  const mod = await import(/* @vite-ignore */ path);
  const res: Response = await mod.POST(
    new NextRequest('https://app.test/api/autoswap/x', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, text: await res.text() };
}

beforeEach(() => {
  db = new FakeSupabase();
  auth = { user: null, error: null };
  zrCalls.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  configure(A);
  configure(B);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(ROUTES)('POST /api/autoswap/%s', (_name, path) => {
  it('A — sans identifiants : 401, AUCUN appel ZRExpress, même avec clé et tenant dans le corps', async () => {
    const r = await call(path, { token: KEY[A], tenantId: ZR_TENANT[A] });
    expect(r.status).toBe(401);
    expect(zrCalls).toHaveLength(0);
    expect(r.text).not.toContain(A_SECRET_PARCEL);
  });

  it('B — cookie invalide (getUser renvoie une erreur) : 401, aucun appel', async () => {
    auth = { user: null, error: { message: 'invalid JWT' } };
    const r = await call(path, { token: KEY[A], tenantId: ZR_TENANT[A] });
    expect(r.status).toBe(401);
    expect(zrCalls).toHaveLength(0);
  });

  it('C — session de B, corps forgé avec la clé, le tenant et le user_id de A : seules les données de B', async () => {
    auth = { user: { id: B }, error: null };
    const r = await call(path, {
      token: KEY[A],
      tenantId: ZR_TENANT[A],
      user_id: A,
      tenant_id: A,
    });
    expect(r.status).toBe(200);
    expect(zrCalls.length).toBeGreaterThan(0);
    expect(zrCalls.every((c) => c.key === KEY[B] && c.tenant === ZR_TENANT[B])).toBe(true);
    expect(r.text).not.toContain(A_SECRET_PARCEL);
    expect(r.text).not.toContain(KEY[A]);
    expect(r.text).not.toContain(KEY[B]); // la clé ne revient jamais au navigateur
  });

  it('D — session valide sans identifiants ZR configurés : 400 ZR_NOT_CONFIGURED, aucun appel', async () => {
    const C = '33333333-3333-4333-8333-333333333333';
    auth = { user: { id: C }, error: null };
    const r = await call(path, { token: KEY[A], tenantId: ZR_TENANT[A] });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.text).code).toBe('ZR_NOT_CONFIGURED');
    expect(zrCalls).toHaveLength(0);
  });

  it('E — session et tenant corrects : 200, ZRExpress appelé avec SES identifiants', async () => {
    auth = { user: { id: A }, error: null };
    const r = await call(path);
    expect(r.status).toBe(200);
    expect(zrCalls.every((c) => c.key === KEY[A] && c.tenant === ZR_TENANT[A])).toBe(true);
    expect(zrCalls.length).toBeGreaterThan(0);
    JSON.parse(r.text);
  });

  it('aucun effet de bord : aucune écriture en base, ZRExpress en lecture seule (/parcels/search)', async () => {
    for (const u of [null, { id: A }, { id: B }]) {
      auth = { user: u, error: null };
      await call(path, { token: KEY[A], tenantId: ZR_TENANT[A] });
    }
    expect(db.writes).toHaveLength(0);
    expect(zrCalls.every((c) => c.url.endsWith('/parcels/search') && c.method === 'POST')).toBe(
      true
    );
  });
});
