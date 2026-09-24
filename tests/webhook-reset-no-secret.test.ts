// /api/ai-chatbot/whatsapp/webhook-reset — le secret GLOBAL du webhook ne doit
// jamais atteindre le navigateur d'un marchand.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import { redactWebhookToken } from '@/lib/security/webhook-auth';

const SECRET = 'wa-webhook-secret-TEST-0123456789';
const USER = '11111111-1111-4111-8111-111111111111';
let db: FakeSupabase;
let stored = ''; // URL enregistrée côté Evolution simulé

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(Object.create(db), {
      from: db.from.bind(db),
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    }),
  createServiceClient: () => db,
}));
vi.mock('@/lib/user-creds', () => ({
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'global-key' }),
}));

beforeEach(() => {
  db = new FakeSupabase();
  stored = '';
  vi.resetModules();
  vi.stubEnv('WHATSAPP_WEBHOOK_SECRET', SECRET); // lu à l'import de la route
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/webhook/set/')) {
        stored = JSON.parse(String(init?.body)).url;
        // Evolution renvoie la configuration enregistrée (URL comprise).
        return new Response(
          JSON.stringify({ webhook: { url: stored, events: ['MESSAGES_UPSERT'] } })
        );
      }
      if (url.includes('/webhook/find/')) {
        return Response.json({ url: stored, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] });
      }
      return Response.json({});
    })
  );
  db.seed('public', 'whatsapp_instances', [
    { user_id: USER, instance_name: 'zrex_test_auto', service_type: 'auto_confirmation' },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('webhook-reset', () => {
  it('enregistre bien l’URL AVEC le secret chez Evolution…', async () => {
    const { POST } = await import('@/app/api/ai-chatbot/whatsapp/webhook-reset/route');
    await POST(
      new (await import('next/server')).NextRequest('https://app.test/x', { method: 'POST' })
    );
    expect(stored).toContain(`token=${SECRET}`);
  });

  it('…mais la réponse au navigateur ne contient JAMAIS le secret', async () => {
    const { POST } = await import('@/app/api/ai-chatbot/whatsapp/webhook-reset/route');
    const res = await POST(
      new (await import('next/server')).NextRequest('https://app.test/x', { method: 'POST' })
    );
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const json = JSON.parse(text);
    expect(json.verified).toBe(1); // la vérification interne compare toujours la vraie URL
    expect(json.webhook_url_sent).toContain('token=••••');
  });
});

describe('redactWebhookToken', () => {
  it.each([
    ['https://a.test/hook?token=abc123', 'https://a.test/hook?token=••••'],
    ['https://a.test/hook?x=1&token=abc&y=2', 'https://a.test/hook?x=1&token=••••&y=2'],
    ['{"url":"https://a.test/h?token=abc"}', '{"url":"https://a.test/h?token=••••"}'],
    ['https://a.test/hook', 'https://a.test/hook'],
  ])('%s', (input, out) => expect(redactWebhookToken(input)).toBe(out));
  it('null reste null', () => expect(redactWebhookToken(null)).toBeNull());
});
