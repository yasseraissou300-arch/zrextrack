// P2-9 phase 1 — la clé API ZRExpress ne quitte jamais le serveur.
//
// Pour chaque route qui recevait la clé depuis le navigateur :
//   1. une clé injectée dans le corps est IGNORÉE : ZRExpress est appelé avec
//      la clé STOCKÉE du tenant de la session ;
//   2. sans clé stockée → 400 ZR_NOT_CONFIGURED, AUCUN appel ZRExpress, même
//      si le corps contient une clé ;
//   3. aucune réponse ne contient la clé stockée.
// Et : GET /api/sync-settings ne renvoie plus la clé ; PUT la chiffre.
// Aucune valeur réelle : clés factices, trousseau généré à l'exécution.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { seal, isSealed } from '@/lib/security/secret-box';
import { zrTokenContext } from '@/lib/zrexpress/credentials';

let db: FakeSupabase;
let currentUser: { id: string } | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
}));

const USER = '11111111-1111-4111-8111-111111111111';
const STORED = 'zr-stored-key-AAAA-0123456789';
const INJECTED = 'zr-injected-key-EVIL-9876543210';
const ZR_TENANT = 'zr-tenant-test';
const KEYRING = `k1:${crypto.randomBytes(32).toString('base64')}`;

const zrCalls: Array<{ url: string; key: string | null }> = [];
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  zrCalls.push({ url: String(input), key: headers.get('x-api-key') });
  if (String(input).includes('/parcels/search')) {
    return Response.json({ items: [], totalPages: 1, hasNext: false });
  }
  return Response.json({ ok: true });
});

function storeToken(value: string) {
  db.seed('public', 'user_sync_settings', [
    { user_id: USER, zrexpress_token: value, zrexpress_tenant_id: ZR_TENANT, templates: {} },
  ]);
}

beforeEach(() => {
  db = new FakeSupabase();
  currentUser = { id: USER };
  zrCalls.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('SECRETS_KEYRING', KEYRING);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  db.seed('public', 'profiles', [{ id: USER, plan_id: 'pro', role: null }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const swap = {
  swappable: { id: 'p1', tracking: 'ZR-S' },
  target: {
    tracking: 'ZR-T',
    amount: 1000,
    customer: 'C',
    swapPayload: {
      phone: '0550',
      deliveryType: 'home',
      deliveryAddress: {},
      hubId: null,
      customerId: null,
    },
  },
};

const ROUTES: Array<{ name: string; path: string; body: Record<string, unknown> }> = [
  { name: 'sync-zrexpress', path: '@/app/api/sync-zrexpress/route', body: {} },
  { name: 'autoswap/preview', path: '@/app/api/autoswap/preview/route', body: {} },
  { name: 'autoswap/diagnostic', path: '@/app/api/autoswap/diagnostic/route', body: {} },
  { name: 'autoswap/swapped-stats', path: '@/app/api/autoswap/swapped-stats/route', body: {} },
  {
    name: 'autoswap/execute',
    path: '@/app/api/autoswap/execute/route',
    body: { approved_swaps: [swap] },
  },
  {
    name: 'campaigns/delivered-customers',
    path: '@/app/api/campaigns/delivered-customers/route',
    body: {},
  },
  {
    name: 'reclamations/lookup',
    path: '@/app/api/ai-chatbot/reclamations/lookup/route',
    body: { items: [{ sessionId: 's1', commande: 'ZR-1', phone: '213550000001' }] },
  },
];

async function call(path: string, body: Record<string, unknown>) {
  const mod = await import(/* @vite-ignore */ path);
  const res: Response = await mod.POST(
    new NextRequest('https://app.test/api/x', {
      method: 'POST',
      // Tentative d'injection : clé et tenant fournis par le « navigateur ».
      body: JSON.stringify({ ...body, token: INJECTED, tenantId: 'evil-tenant' }),
    })
  );
  return { status: res.status, text: await res.text() };
}

describe.each(ROUTES)('$name', ({ path, body }) => {
  it('ignore la clé injectée et utilise la clé STOCKÉE (chiffrée) du tenant', async () => {
    storeToken(seal(STORED, zrTokenContext(USER)));
    const { text } = await call(path, body);
    expect(zrCalls.length).toBeGreaterThan(0);
    expect(zrCalls.every((c) => c.key === STORED)).toBe(true);
    expect(text).not.toContain(STORED);
    expect(text).not.toContain(INJECTED);
  });

  it('clé historique en clair : toujours utilisable (migration progressive)', async () => {
    storeToken(STORED);
    await call(path, body);
    expect(zrCalls.every((c) => c.key === STORED)).toBe(true);
  });

  it('aucune clé stockée → 400, AUCUN appel ZRExpress malgré la clé injectée', async () => {
    const { status, text } = await call(path, body);
    expect(status).toBe(400);
    expect(JSON.parse(text).code).toBe('ZR_NOT_CONFIGURED');
    expect(zrCalls).toHaveLength(0);
  });

  it('valeur illisible (autre trousseau) → « non configuré », pas de 500 ni de fuite', async () => {
    storeToken(
      seal(STORED, zrTokenContext(USER), {
        SECRETS_KEYRING: `k1:${crypto.randomBytes(32).toString('base64')}`,
      } as unknown as NodeJS.ProcessEnv)
    );
    const { status, text } = await call(path, body);
    expect(status).toBe(400);
    expect(zrCalls).toHaveLength(0);
    expect(text).not.toContain(STORED);
  });

  it('sans session → 401, aucun appel ZRExpress', async () => {
    currentUser = null;
    storeToken(STORED);
    const { status } = await call(path, body);
    expect(status).toBe(401);
    expect(zrCalls).toHaveLength(0);
  });
});

describe('/api/sync-settings', () => {
  async function get() {
    const { GET } = await import('@/app/api/sync-settings/route');
    const res = await GET();
    return { status: res.status, text: await res.text() };
  }
  async function put(body: Record<string, unknown>) {
    const { PUT } = await import('@/app/api/sync-settings/route');
    return PUT(
      new NextRequest('https://app.test/api/sync-settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    );
  }

  it('GET ne renvoie jamais la clé : seulement « configurée » et 4 caractères', async () => {
    storeToken(STORED);
    const { text } = await get();
    expect(text).not.toContain(STORED);
    expect(text).not.toContain('zrexpress_token"');
    const s = JSON.parse(text).settings;
    expect(s.zrexpress_configured).toBe(true);
    expect(s.zrexpress_token_masked).toBe(`••••${STORED.slice(-4)}`);
  });

  it('GET avec une valeur chiffrée : idem, et rien du chiffré', async () => {
    const sealed = seal(STORED, zrTokenContext(USER));
    storeToken(sealed);
    const { text } = await get();
    expect(text).not.toContain(STORED);
    expect(text).not.toContain(sealed);
  });

  it('PUT chiffre la clé quand le trousseau est configuré', async () => {
    await put({ zrexpress_token: STORED, zrexpress_tenant_id: ZR_TENANT });
    const stored = db.all('public', 'user_sync_settings')[0].zrexpress_token;
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain(STORED);
  });

  it('PUT sans trousseau : comportement actuel (clair), rien de cassé', async () => {
    vi.stubEnv('SECRETS_KEYRING', '');
    await put({ zrexpress_token: STORED, zrexpress_tenant_id: ZR_TENANT });
    expect(db.all('public', 'user_sync_settings')[0].zrexpress_token).toBe(STORED);
  });

  it('PUT sans clé (ex. modèles) conserve la valeur stockée à l’identique, sans re-chiffrer', async () => {
    const sealed = seal(STORED, zrTokenContext(USER));
    storeToken(sealed);
    await put({ templates: { livre: 'x' } });
    expect(db.all('public', 'user_sync_settings')[0].zrexpress_token).toBe(sealed);
  });

  it('PUT avec clé vide la supprime', async () => {
    storeToken(STORED);
    await put({ zrexpress_token: '', zrexpress_tenant_id: '' });
    expect(db.all('public', 'user_sync_settings')[0].zrexpress_token).toBeNull();
  });
});
