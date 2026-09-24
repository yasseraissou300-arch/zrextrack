// Relance des conversations inactives + résolution SAV — portée, rafale,
// instance, doubles envois.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
let currentUser: { id: string } | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
}));
vi.mock('@/lib/user-creds', () => ({
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'global-key' }),
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OLD = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

const sends: Array<{ instance: string; number: string; text: string }> = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  await new Promise((r) => setTimeout(r, 2));
  const body = JSON.parse(String(init?.body ?? '{}'));
  sends.push({ instance: url.split('/').pop() ?? '', number: body.number, text: body.text });
  return new Response('{}');
});

function seedTenant(t: string, sessions: Array<{ id: string; template_type?: string }>) {
  db.seed('public', 'whatsapp_instances', [
    {
      user_id: t,
      service_type: 'auto_confirmation',
      instance_name: `${t.slice(0, 4)}_auto`,
      connected: true,
    },
    { user_id: t, service_type: 'sav', instance_name: `${t.slice(0, 4)}_sav`, connected: true },
  ]);
  db.seed('public', 'profiles', [{ id: t, whatsapp_warmup_started_at: null }]);
  db.seed(
    'public',
    'ai_chat_sessions',
    sessions.map((s, i) => ({
      id: s.id,
      user_id: t,
      channel: 'whatsapp',
      contact_id: `21355000${t.slice(0, 1)}00${i}@s.whatsapp.net`,
      template_type: s.template_type ?? 'auto_confirmation',
      is_complete: false,
      human_handover: false,
      relance_sent: false,
      updated_at: OLD,
    }))
  );
}

beforeEach(() => {
  db = new FakeSupabase();
  sends.length = 0;
  currentUser = null;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CRON_SECRET', '');
  vi.resetModules();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function call(opts: { bearer?: string } = {}) {
  const { POST } = await import('@/app/api/ai-chatbot/relance/route');
  const res = await POST(
    new NextRequest('https://app.test/api/ai-chatbot/relance', {
      method: 'POST',
      headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
      body: '{}',
    })
  );
  return { status: res.status, json: await res.json() };
}

describe('portée', () => {
  it('sans secret configuré ni session : refus (avant : relance de TOUS les tenants)', async () => {
    seedTenant(A, [{ id: 'a1' }]);
    const { status } = await call();
    expect(status).toBe(401);
    expect(sends).toHaveLength(0);
  });

  it('le bouton d’un marchand ne relance que SES conversations', async () => {
    seedTenant(A, [{ id: 'a1' }]);
    seedTenant(B, [{ id: 'b1' }]);
    currentUser = { id: A };
    const { status, json } = await call();
    expect(status).toBe(200);
    expect(json.scope).toBe('tenant');
    expect(sends.map((s) => s.instance)).toEqual(['1111_auto']);
    const b1 = db.all('public', 'ai_chat_sessions').find((s) => s.id === 'b1');
    expect(b1?.relance_sent).toBe(false);
  });

  it('planificateur avec le bon secret : tous les tenants', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-test-secret');
    seedTenant(A, [{ id: 'a1' }]);
    seedTenant(B, [{ id: 'b1' }]);
    const { json } = await call({ bearer: 'cron-test-secret' });
    expect(json.scope).toBe('all');
    expect(sends.map((s) => s.instance).sort()).toEqual(['1111_auto', '2222_auto']);
  });

  it('mauvais secret, pas de session → 401', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-test-secret');
    seedTenant(A, [{ id: 'a1' }]);
    expect((await call({ bearer: 'wrong' })).status).toBe(401);
  });
});

describe('anti-rafale et plafond', () => {
  it('un seul envoi par tenant et par exécution (avant : jusqu’à 50 d’affilée)', async () => {
    seedTenant(A, [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    currentUser = { id: A };
    const { json } = await call();
    expect(json.relanced).toBe(1);
    expect(sends).toHaveLength(1);
    const pending = db.all('public', 'ai_chat_sessions').filter((s) => !s.relance_sent);
    expect(pending).toHaveLength(2); // relancées aux exécutions suivantes
  });

  it('plafond journalier atteint → aucune relance', async () => {
    seedTenant(A, [{ id: 'a1' }]);
    db.seed(
      'public',
      'messages',
      Array.from({ length: 40 }, () => ({
        user_id: A,
        status: 'envoye',
        sent_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }))
    );
    currentUser = { id: A };
    const { json } = await call();
    expect(json.relanced).toBe(0);
    expect(json.skipped.daily_limit).toBe(1);
    expect(db.all('public', 'ai_chat_sessions')[0].relance_sent).toBe(false);
  });

  it('la relance est journalisée : elle compte dans le plafond', async () => {
    seedTenant(A, [{ id: 'a1' }]);
    currentUser = { id: A };
    await call();
    expect(db.all('public', 'messages')).toHaveLength(1);
    expect(db.all('public', 'messages')[0].status).toBe('envoye');
  });
});

describe('instance et doubles envois', () => {
  it('une session SAV est relancée depuis l’instance SAV', async () => {
    seedTenant(A, [{ id: 'a1', template_type: 'sav' }]);
    currentUser = { id: A };
    await call();
    expect(sends[0].instance).toBe('1111_sav');
  });

  it('deux exécutions simultanées ne relancent qu’une fois', async () => {
    seedTenant(A, [{ id: 'a1' }]);
    currentUser = { id: A };
    await Promise.all([call(), call()]);
    expect(sends).toHaveLength(1);
  });
});

describe('résolution SAV', () => {
  it('deux clics simultanés → un seul message au client', async () => {
    db.seed('public', 'whatsapp_instances', [
      { user_id: A, service_type: 'sav', instance_name: '1111_sav', connected: true },
    ]);
    db.seed('public', 'ai_chat_sessions', [
      {
        id: 's1',
        user_id: A,
        channel: 'whatsapp',
        contact_id: '213550000001@s.whatsapp.net',
        contact_name: 'Amine',
        template_type: 'sav',
      },
    ]);
    currentUser = { id: A };
    const { POST } = await import('@/app/api/ai-chatbot/reclamations/resolve/route');
    const click = () =>
      POST(
        new NextRequest('https://app.test/api/ai-chatbot/reclamations/resolve', {
          method: 'POST',
          body: JSON.stringify({ sessionId: 's1', resolution: 'refund' }),
        })
      );
    const [r1, r2] = await Promise.all([click(), click()]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(sends).toHaveLength(1);
  });
});
