// Webhook WhatsApp entrant (/api/ai-chatbot/webhook/whatsapp) — authentification
// et isolation, au niveau de la ROUTE (WEBHOOK-SECRET-001).
// Tout appel réseau (Evolution, Gemini) fait échouer le test : aucune requête
// refusée ne doit déclencher de travail.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { instanceNameFor } from '@/lib/whatsapp/instance-ownership';

let db: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => db,
}));

const SECRET = 'TEST_WA_WEBHOOK_SECRET_0123456789';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const URL_ = 'https://app.test/api/ai-chatbot/webhook/whatsapp';
const networkCalls: string[] = [];

function body(instance: string, id = `MSG-${Math.random().toString(36).slice(2)}`) {
  return JSON.stringify({
    event: 'messages.upsert',
    instance,
    data: {
      key: { remoteJid: '213550000001@s.whatsapp.net', fromMe: false, id },
      message: { conversation: 'Salam' },
    },
  });
}

async function post(payload: string, opts: { header?: string; query?: string } = {}) {
  vi.resetModules();
  const { POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.header !== undefined) headers['x-webhook-token'] = opts.header;
  const url = opts.query !== undefined ? `${URL_}?token=${encodeURIComponent(opts.query)}` : URL_;
  const res = await POST(new NextRequest(url, { method: 'POST', headers, body: payload }));
  return { status: res.status, text: await res.text() };
}

beforeEach(() => {
  db = new FakeSupabase();
  networkCalls.length = 0;
  vi.stubEnv('WHATSAPP_WEBHOOK_SECRET', SECRET);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: unknown) => {
      networkCalls.push(String(u));
      throw new Error('appel réseau interdit dans ce test');
    })
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('secret configuré', () => {
  it('A — jeton absent → 401, aucun travail', async () => {
    const r = await post(body(instanceNameFor(A, 'auto_confirmation')));
    expect(r.status).toBe(401);
    expect(networkCalls).toHaveLength(0);
    expect(db.all('autotim', 'webhook_events')).toHaveLength(0);
  });

  it('B — mauvais jeton (en-tête ou ?token=) → 403', async () => {
    expect((await post(body('x'), { header: 'TEST_WRONG' })).status).toBe(403);
    expect((await post(body('x'), { query: 'TEST_WRONG' })).status).toBe(403);
    expect((await post(body('x'), { header: `${SECRET}x` })).status).toBe(403);
    expect(networkCalls).toHaveLength(0);
  });

  it('C — bon jeton (en-tête ou ?token=) → accepté', async () => {
    for (const opts of [{ header: SECRET }, { query: SECRET }]) {
      const r = await post(body('zrex_000000000000_auto'), opts);
      expect(r.status).toBe(200); // instance inconnue → ignoré proprement
    }
  });

  it('D — charge utile forgée/malformée avec bon jeton → 400, aucun travail', async () => {
    for (const p of ['pas du json', '{}', '{"event": 42}']) {
      expect((await post(p, { header: SECRET })).status).toBe(400);
    }
    expect(networkCalls).toHaveLength(0);
  });

  it('E — même message livré deux fois → traité une seule fois', async () => {
    const p = body(instanceNameFor(A, 'auto_confirmation'), 'EVO-DUP-AUTH');
    const first = await post(p, { header: SECRET });
    const second = await post(p, { header: SECRET });
    expect(first.status).toBe(200);
    expect(JSON.parse(second.text).deduped).toBe(true);
  });

  it('F — ligne du tenant A portant le nom de l’instance de B → jamais routée vers A', async () => {
    db.seed('public', 'whatsapp_instances', [
      {
        user_id: A,
        service_type: 'auto_confirmation',
        instance_name: instanceNameFor(B, 'auto_confirmation'),
      },
    ]);
    const r = await post(body(instanceNameFor(B, 'auto_confirmation')), { header: SECRET });
    expect(r.status).toBe(200);
    expect(networkCalls).toHaveLength(0); // ni Gemini ni Evolution pour A
    expect(db.all('public', 'ai_chat_sessions')).toHaveLength(0);
  });

  it('G — erreur interne : jamais de détail dans la réponse', async () => {
    db.failNext('public', 'whatsapp_instances', 'select', {
      code: 'XX000',
      message: 'TEST_INTERNAL host=10.0.0.5 password=TEST_PWD',
    });
    const r = await post(body(instanceNameFor(A, 'auto_confirmation')), { header: SECRET });
    expect(r.status).toBe(200);
    for (const leak of ['TEST_INTERNAL', '10.0.0.5', 'TEST_PWD'])
      expect(r.text).not.toContain(leak);
  });
});

describe('secret NON configuré (état constaté en production le 2026-10-15)', () => {
  it('documente le risque : sans WHATSAPP_WEBHOOK_SECRET, un appel sans jeton passe l’authentification', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_SECRET', '');
    const r = await post('{}');
    // 400 « Bad payload » = l'authentification a été franchie. Correctif :
    // définir le secret (WEBHOOK-SECRET-001) — après quoi ce même appel → 401.
    expect(r.status).toBe(400);
  });
});
