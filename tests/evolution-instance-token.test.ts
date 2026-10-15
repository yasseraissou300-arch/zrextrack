// P0 — jeton d'instance Evolution.
//
// Evolution v2 (src/api/guards/auth.guard.ts) accepte, pour toute route
// /…/:instanceName, SOIT la clé globale, SOIT le `token` de l'instance.
// L'ancienne création passait `token: user.id` : quiconque connaissait l'UUID
// d'un marchand (non secret — deux UUID réels étaient dans le dépôt public) et
// l'URL Evolution pouvait envoyer des WhatsApp depuis son numéro, lire ses
// discussions ou le déconnecter.
//
// Ces tests exercent la vraie route avec Supabase et fetch simulés.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const calls = {
  upserts: [] as Array<Record<string, unknown>>,
  selects: [] as string[],
};

function queryStub(rows: unknown[]) {
  const q: any = {
    select: (cols?: string) => {
      calls.selects.push(cols ?? '*');
      return q;
    },
    upsert: (row: Record<string, unknown>) => {
      calls.upserts.push(row);
      return q;
    },
    delete: () => q,
    eq: () => q,
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: () => queryStub([{ id: 'x', user_id: USER_ID }]),
  }),
  createServiceClient: () => ({
    from: () => queryStub([{ id: 'x', user_id: USER_ID }]),
  }),
}));

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 })
);

beforeEach(() => {
  calls.upserts.length = 0;
  calls.selects.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('EVOLUTION_API_URL', 'https://evolution.test');
  vi.stubEnv('EVOLUTION_API_KEY', 'global-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function createInstance() {
  const { POST } = await import('@/app/api/ai-chatbot/whatsapp/instance/route');
  const req = new NextRequest('https://app.test/api/ai-chatbot/whatsapp/instance', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', service_type: 'auto_confirmation' }),
  });
  return POST(req);
}

function createBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/instance/create'));
  expect(call).toBeDefined();
  return JSON.parse(String(call![1]!.body));
}

describe('création d’instance Evolution — jeton', () => {
  it('ne transmet aucun `token` : Evolution en génère un aléatoire', async () => {
    const res = await createInstance();
    expect(res.status).toBe(200);
    expect(createBody()).not.toHaveProperty('token');
  });

  it('l’UUID du marchand n’apparaît nulle part dans la requête de création', async () => {
    await createInstance();
    const raw = JSON.stringify(createBody());
    expect(raw).not.toContain(USER_ID);
    expect(raw).not.toContain(USER_ID.replace(/-/g, ''));
  });

  it('ne stocke pas l’UUID comme jeton d’instance', async () => {
    await createInstance();
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0].instance_token).not.toBe(USER_ID);
  });

  it('la réponse n’expose pas `instance_token`', async () => {
    await createInstance();
    expect(calls.selects.some((c) => c === '*' || c.includes('instance_token'))).toBe(false);
  });

  it('continue d’authentifier Evolution avec la clé globale', async () => {
    await createInstance();
    for (const [, init] of fetchMock.mock.calls) {
      expect((init!.headers as Record<string, string>).apikey).toBe('global-key');
    }
  });
});

describe('lecture des instances', () => {
  it('GET ne sélectionne jamais `*` ni `instance_token`', async () => {
    const { GET } = await import('@/app/api/ai-chatbot/whatsapp/instance/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(calls.selects.length).toBeGreaterThan(0);
    for (const c of calls.selects) {
      expect(c).not.toBe('*');
      expect(c).not.toContain('instance_token');
    }
  });
});
