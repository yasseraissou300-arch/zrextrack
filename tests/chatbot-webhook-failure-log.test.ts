// P4 — /api/chatbot : échec d'envoi au webhook Sheets (notifyWebhook) visible côté serveur.
//
// CONSTAT (code) : notifyWebhook POST le JSON de la commande / réclamation vers
// GOOGLE_SHEETS_WEBHOOK_URL (variable d'environnement de PLATEFORME), ignore le
// statut HTTP et avale toute exception (catch vide). Une commande confirmée ou
// une réclamation « enregistrée » côté client pouvait ne jamais arriver, sans
// aucune trace. Variable absente → aucun envoi (pas un échec).
//
// L'URL d'un webhook Apps Script est elle-même l'autorisation d'écrire : elle
// est traitée comme un SECRET. Correction attendue : OBSERVABILITÉ SEULE —
// chatbot.sheets {status:'failed', channel:'dashboard', flow:'order'|'complaint',
// tenant_id, http_status + error_code (catégorie) | error_code 'network_error' +
// cause (nom de l'erreur), ref}. Jamais l'URL, le jeton, le corps envoyé ou
// reçu, ni le message / la pile de l'exception. Réponse /api/chatbot, contenu
// envoyé et nombre d'appels : inchangés.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const T = '11111111-1111-4111-8111-111111111111';
const SECRET = 'SECRET-TOKEN-987654';
const DEPLOY = 'AKfycbSecretDeploymentId123456';
const WEBHOOK = `https://script.google.com/macros/s/${DEPLOY}/exec?token=${SECRET}`;
const NOW = new Date('2026-10-04T10:00:00.000Z');

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: T } } }) } }),
}));
vi.mock('@/lib/user-creds', () => ({ resolveGeminiKeys: async () => [] }));

type Outcome = { status: number; body?: string } | 'network';
let outcome: Outcome = { status: 200 };
const hooks: Array<{ url: string; method?: string; headers: unknown; body: unknown }> = [];

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('https://script.google.com/')) {
    hooks.push({
      url,
      method: init?.method,
      headers: init?.headers,
      body: JSON.parse(String(init?.body)),
    });
    if (outcome === 'network') {
      const e = new TypeError(`fetch failed: request to ${url} failed, reason: ECONNRESET`);
      e.stack = `TypeError: fetch failed ${url}\n    at undici Authorization: Bearer ${SECRET}`;
      throw e;
    }
    const body =
      outcome.body ?? (outcome.status < 300 ? '{"ok":true}' : `<html>Error ${WEBHOOK}</html>`);
    return new Response(outcome.status === 204 ? null : body, { status: outcome.status });
  }
  return new Response('{}');
});

const ORDER = {
  name: 'Amine Bensalah',
  phone: '0550000001',
  products: 'Montre noire x2',
  address: 'Oran, Bir El Djir, rue des Oliviers',
};
const COMPLAINT = 'Colis abîmé, je suis Amine Bensalah 0550000001 à Oran, rue des Oliviers';

async function chat(flow: 'order' | 'complaint') {
  const { POST } = await import('@/app/api/chatbot/route');
  const res = await POST(
    new NextRequest('https://app.test/api/chatbot', {
      method: 'POST',
      body: JSON.stringify(
        flow === 'order'
          ? {
              message: 'oui',
              sessionState: { intent: 'order', step: 'confirm', data: ORDER },
              history: [],
              channel: 'web',
            }
          : {
              message: COMPLAINT,
              sessionState: { intent: 'complaint', step: 'collect_complaint', data: {} },
              history: [],
              channel: 'web',
            }
      ),
    })
  );
  return { status: res.status, body: await res.json() };
}

const TICKET = `#${NOW.getTime().toString().slice(-6)}`;
const EXPECTED = {
  order: {
    response: {
      reply: `🎉 **Commande confirmée !**\n\nVotre commande a bien été enregistrée. Notre équipe vous contactera au **${ORDER.phone}** sous peu pour finaliser les détails.\n\nMerci de votre confiance ! 🙏\n\nComment puis-je encore vous aider ?`,
      newState: { intent: null, step: 'done', data: ORDER },
    },
    sent: { type: 'order', timestamp: NOW.toISOString(), source: 'chatbot', ...ORDER },
  },
  complaint: {
    response: {
      reply: `📝 **Réclamation enregistrée !**\n\nN° de ticket : **${TICKET}**\n\nVotre réclamation a été transmise à notre équipe. Un conseiller vous recontactera rapidement.\n\nY a-t-il autre chose que je puisse faire pour vous ?`,
      newState: { intent: null, step: 'detect', data: {} },
    },
    sent: {
      type: 'complaint',
      timestamp: NOW.toISOString(),
      source: 'chatbot',
      complaint: COMPLAINT,
      ticket: TICKET,
    },
  },
} as const;

function logLines(): string[] {
  return (['log', 'info', 'warn', 'error', 'debug'] as const).flatMap((m) =>
    (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      c.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' ')
    )
  );
}
const failures = () =>
  logLines()
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.scope === 'chatbot.sheets' && l.status === 'failed');

beforeEach(() => {
  outcome = { status: 200 };
  hooks.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GOOGLE_SHEETS_WEBHOOK_URL', WEBHOOK);
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const SUCCESSES: Outcome[] = [
  { status: 200 },
  { status: 201 },
  { status: 204 },
  { status: 200, body: `<html>Script OK ${WEBHOOK}</html>` }, // non-JSON : reste un succès
];
const HTTP_FAILURES: Array<{ status: number; code: string }> = [
  { status: 400, code: 'rejected' },
  { status: 401, code: 'unauthorized' },
  { status: 403, code: 'unauthorized' },
  { status: 404, code: 'not_found' },
  { status: 429, code: 'rate_limited' },
  { status: 500, code: 'server_error' },
  { status: 502, code: 'server_error' },
  { status: 503, code: 'server_error' },
];

describe.each(['order', 'complaint'] as const)('notifyWebhook — %s', (flow) => {
  function expectUnchanged(r: Awaited<ReturnType<typeof chat>>) {
    expect(r).toEqual({ status: 200, body: EXPECTED[flow].response });
    expect(hooks).toHaveLength(1); // aucun retry
    expect(hooks[0]).toEqual({
      url: WEBHOOK,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: EXPECTED[flow].sent,
    });
  }

  it.each(SUCCESSES)('2xx %j → succès, aucune trace', async (o) => {
    outcome = o;
    expectUnchanged(await chat(flow));
    expect(failures()).toHaveLength(0);
  });

  it.each(HTTP_FAILURES)('$status → UNE trace sûre, réponse et envoi inchangés', async (f) => {
    outcome = { status: f.status };
    expectUnchanged(await chat(flow));
    expect(failures()).toEqual([
      {
        ts: NOW.toISOString(),
        level: 'warn',
        scope: 'chatbot.sheets',
        tenant_id: T,
        channel: 'dashboard',
        flow,
        status: 'failed',
        http_status: f.status,
        error_code: f.code,
        ref: expect.stringMatching(/^E-[0-9a-f]{8}$/),
      },
    ]);
  });

  it('exception réseau (message et pile avec l’URL et le jeton) → UNE trace network_error', async () => {
    outcome = 'network';
    expectUnchanged(await chat(flow));
    expect(failures()).toEqual([
      {
        ts: NOW.toISOString(),
        level: 'warn',
        scope: 'chatbot.sheets',
        tenant_id: T,
        channel: 'dashboard',
        flow,
        status: 'failed',
        error_code: 'network_error',
        cause: 'TypeError',
        ref: expect.stringMatching(/^E-[0-9a-f]{8}$/),
      },
    ]);
  });

  it('webhook non configuré → aucun appel, aucune trace, réponse inchangée', async () => {
    vi.stubEnv('GOOGLE_SHEETS_WEBHOOK_URL', '');
    const r = await chat(flow);
    expect(r).toEqual({ status: 200, body: EXPECTED[flow].response });
    expect(hooks).toHaveLength(0);
    expect(failures()).toHaveLength(0);
  });

  it.each([{ status: 500 }, { status: 403 }, 'network' as const])(
    'journal sûr (%j) : ni URL, jeton, déploiement, Authorization, corps, PII ni exception',
    async (o) => {
      outcome = o;
      await chat(flow);
      expect(failures()).toHaveLength(1);
      const all = logLines().join('\n');
      for (const forbidden of [
        WEBHOOK,
        SECRET,
        SECRET.slice(0, 10),
        DEPLOY,
        DEPLOY.slice(-8),
        'token=',
        'script.google.com',
        'macros',
        'Authorization',
        'Bearer',
        '<html>',
        'ECONNRESET',
        'undici',
        'fetch failed',
        'Amine',
        'Bensalah',
        '0550000001',
        'Oran',
        'Oliviers',
        'Montre',
        'abîmé',
        TICKET,
      ]) {
        expect(all).not.toContain(forbidden);
      }
    }
  );
});
