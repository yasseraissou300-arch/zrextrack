// P4 — /api/chatbot (assistant du tableau de bord) : échecs Gemini visibles côté serveur.
//
// CONSTAT (code) : callGemini parcourt le pool de clés du marchand ; un statut
// ≠ 2xx (`continue`), une exception (catch vide) ou une réponse 200 sans texte
// passent à la clé suivante SANS AUCUNE trace ; pool épuisé → null, silencieux.
// detectIntent (étape « detect », message sans mot-clé) appelle callGemini avec
// un prompt de classification et retombe SILENCIEUSEMENT sur 'sav' ; l'étape
// « detect » peut donc parcourir le pool DEUX fois pour un seul message
// (classification, puis réponse). La route répond toujours 200 {reply, newState}
// avec un texte de repli : aucune erreur n'atteint le navigateur.
//
// Correction attendue : OBSERVABILITÉ SEULE via gemini-error.ts — une trace
// ai.gemini {status:'failed'} par appel Gemini échoué, une trace
// {status:'all_keys_failed'} par parcours épuisé, channel 'dashboard', flow
// 'intent' | 'reply'. Réponses HTTP, ordre des clés, nombre d'appels : inchangés.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const T = '11111111-1111-4111-8111-111111111111';
const KEY_A = 'AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvW';
const KEY_B = 'AIzaSyZ9y8X7w6V5u4T3s2R1q0PoNmLkJiHgFeD';
const QUESTION = 'Bonjour, je suis Amine Bensalah 0550000001, quels sont vos délais pour Oran ?';
const REPLY = 'Nos délais sont de 24 à 72 h.';
const HELP_FALLBACK = `Je suis là pour vous aider ! Vous pouvez :\n• 📦 Suivre votre commande (envoyez le numéro de tracking)\n• 🛒 Passer une nouvelle commande\n• ❓ Poser une question sur nos services\n• 🔧 Signaler un problème`;

let pool: string[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: T } } }) } }),
}));
vi.mock('@/lib/user-creds', () => ({ resolveGeminiKeys: async () => pool }));

type Outcome =
  | { kind: 'ok' }
  | { kind: 'http'; status: number; body: string }
  | { kind: 'network' }
  | { kind: 'empty' }
  | { kind: 'invalid_json' };
let outcomes: Record<string, Outcome> = {};
/** Appels Gemini : rang de la clé + nature (classification ou réponse). */
const calls: Array<{ key: number; kind: 'intent' | 'reply' }> = [];

const geminiUrl = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
const googleError = (code: number, status: string, reason?: string) =>
  JSON.stringify({
    error: {
      code,
      message: `Request to ${geminiUrl(KEY_A)} failed (${status}) for "${QUESTION}"`,
      status,
      ...(reason ? { details: [{ reason, metadata: { consumer: 'projects/123456789' } }] } : {}),
    },
  });

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith('https://generativelanguage.googleapis.com')) return new Response('{}');
  const key = new URL(url).searchParams.get('key') ?? '';
  const isIntent = String(init?.body).includes('Classe ce message');
  calls.push({ key: pool.indexOf(key) + 1, kind: isIntent ? 'intent' : 'reply' });
  const out = outcomes[key] ?? { kind: 'ok' };
  if (out.kind === 'network') {
    const e = new TypeError(`fetch failed: ${url} ECONNRESET`);
    e.stack = `TypeError: fetch failed ${url}\n    at undici`;
    throw e;
  }
  if (out.kind === 'http') return new Response(out.body, { status: out.status });
  if (out.kind === 'invalid_json') return new Response('<html>not json</html>', { status: 200 });
  if (out.kind === 'empty')
    return Response.json({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] });
  return Response.json({
    candidates: [{ content: { parts: [{ text: isIntent ? 'sav' : REPLY }] } }],
  });
});

async function chat(step: 'detect' | 'done', message = QUESTION) {
  const { POST } = await import('@/app/api/chatbot/route');
  const res = await POST(
    new NextRequest('https://app.test/api/chatbot', {
      method: 'POST',
      body: JSON.stringify({
        message,
        sessionState: { intent: null, step, data: {} },
        history: [{ role: 'user', content: 'Ana Amine, nheb nchri' }],
        channel: 'web',
      }),
    })
  );
  return { status: res.status, body: await res.json() };
}

function logLines(): string[] {
  return (['log', 'info', 'warn', 'error', 'debug'] as const).flatMap((m) =>
    (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      c.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' ')
    )
  );
}
const geminiLogs = (status?: string) =>
  logLines()
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.scope === 'ai.gemini' && (!status || l.status === status));

beforeEach(() => {
  pool = [KEY_A, KEY_B];
  outcomes = {};
  calls.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DONE_STATE = { intent: null, step: 'detect', data: {} };

const FAILURES: Array<{ name: string; out: Outcome; code: string; http?: number }> = [
  {
    name: '400',
    out: { kind: 'http', status: 400, body: googleError(400, 'INVALID_ARGUMENT') },
    code: 'bad_request',
    http: 400,
  },
  {
    name: '400 clé invalide',
    out: {
      kind: 'http',
      status: 400,
      body: googleError(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID'),
    },
    code: 'invalid_key',
    http: 400,
  },
  {
    name: '401',
    out: { kind: 'http', status: 401, body: googleError(401, 'UNAUTHENTICATED') },
    code: 'authentication_error',
    http: 401,
  },
  {
    name: '403',
    out: { kind: 'http', status: 403, body: googleError(403, 'PERMISSION_DENIED') },
    code: 'authentication_error',
    http: 403,
  },
  {
    name: '429',
    out: { kind: 'http', status: 429, body: googleError(429, 'RESOURCE_EXHAUSTED') },
    code: 'rate_limited',
    http: 429,
  },
  {
    name: '500',
    out: { kind: 'http', status: 500, body: googleError(500, 'INTERNAL') },
    code: 'provider_error',
    http: 500,
  },
  {
    name: '503 HTML avec la clé',
    out: { kind: 'http', status: 503, body: `<html>Unavailable ${geminiUrl(KEY_A)}</html>` },
    code: 'provider_error',
    http: 503,
  },
  { name: 'exception réseau', out: { kind: 'network' }, code: 'network_error' },
  { name: '200 sans texte', out: { kind: 'empty' }, code: 'empty_response', http: 200 },
  { name: '200 JSON invalide', out: { kind: 'invalid_json' }, code: 'provider_error' },
];

// ─── callGemini — flow reply (étape « done » : un seul parcours du pool) ────

describe('callGemini — réponse (flow reply)', () => {
  it('succès → réponse IA, 1 appel, AUCUNE trace ai.gemini', async () => {
    const r = await chat('done');
    expect(r).toEqual({ status: 200, body: { reply: REPLY, newState: DONE_STATE } });
    expect(calls).toEqual([{ key: 1, kind: 'reply' }]);
    expect(geminiLogs()).toHaveLength(0);
  });

  it.each(FAILURES)(
    '$name sur la clé 1 → 1 trace sûre, clé 2 essayée, réponse inchangée',
    async (f) => {
      outcomes = { [KEY_A]: f.out };
      const r = await chat('done');
      expect(r).toEqual({ status: 200, body: { reply: REPLY, newState: DONE_STATE } });
      expect(calls).toEqual([
        { key: 1, kind: 'reply' },
        { key: 2, kind: 'reply' },
      ]);
      const fails = geminiLogs('failed');
      expect(fails).toHaveLength(1); // une seule trace pour un seul appel échoué
      expect(fails[0]).toMatchObject({
        level: 'warn',
        channel: 'dashboard',
        flow: 'reply',
        tenant_id: T,
        key_index: 1,
        pool_size: 2,
        error_code: f.code,
      });
      if (f.http) expect(fails[0].http_status).toBe(f.http);
      else expect(fails[0].http_status).toBeUndefined();
      expect(String(fails[0].ref)).toMatch(/^E-[0-9a-f]{8}$/);
      expect(geminiLogs('all_keys_failed')).toHaveLength(0);
      expect(geminiLogs()).toHaveLength(1);
    }
  );

  it('toutes les clés échouent → 2 traces failed + 1 all_keys_failed, repli inchangé', async () => {
    outcomes = {
      [KEY_A]: { kind: 'http', status: 429, body: googleError(429, 'RESOURCE_EXHAUSTED') },
      [KEY_B]: { kind: 'network' },
    };
    const r = await chat('done');
    expect(r).toEqual({
      status: 200,
      body: { reply: 'Comment puis-je vous aider ?', newState: DONE_STATE },
    });
    expect(calls).toHaveLength(2);
    expect(geminiLogs('failed').map((l) => [l.flow, l.key_index, l.error_code])).toEqual([
      ['reply', 1, 'rate_limited'],
      ['reply', 2, 'network_error'],
    ]);
    expect(geminiLogs('all_keys_failed')).toEqual([
      expect.objectContaining({ channel: 'dashboard', flow: 'reply', tenant_id: T, pool_size: 2 }),
    ]);
  });
});

// ─── detectIntent — flow intent (étape « detect ») ─────────────────────────

describe('detectIntent (flow intent)', () => {
  it('mot-clé « commander » → AUCUN appel Gemini, aucune trace', async () => {
    const r = await chat('detect', 'je veux commander une montre');
    expect(r.status).toBe(200);
    expect(r.body.newState.step).toBe('collect_name');
    expect(calls).toHaveLength(0);
    expect(geminiLogs()).toHaveLength(0);
  });

  it('succès → classification puis réponse (2 appels), aucune trace', async () => {
    const r = await chat('detect');
    expect(r).toEqual({ status: 200, body: { reply: REPLY, newState: DONE_STATE } });
    expect(calls).toEqual([
      { key: 1, kind: 'intent' },
      { key: 1, kind: 'reply' },
    ]);
    expect(geminiLogs()).toHaveLength(0);
  });

  it('clé 1 en 500 → 1 trace intent + 1 trace reply (2 appels échoués distincts), réponse inchangée', async () => {
    outcomes = { [KEY_A]: { kind: 'http', status: 500, body: googleError(500, 'INTERNAL') } };
    const r = await chat('detect');
    expect(r).toEqual({ status: 200, body: { reply: REPLY, newState: DONE_STATE } });
    expect(calls).toEqual([
      { key: 1, kind: 'intent' },
      { key: 2, kind: 'intent' },
      { key: 1, kind: 'reply' },
      { key: 2, kind: 'reply' },
    ]);
    expect(geminiLogs('failed').map((l) => [l.flow, l.key_index])).toEqual([
      ['intent', 1],
      ['reply', 1],
    ]);
    expect(geminiLogs('all_keys_failed')).toHaveLength(0);
  });

  it('toutes les clés échouent → repli silencieux sur « sav » conservé, 1 trace par appel + 1 par parcours', async () => {
    outcomes = {
      [KEY_A]: { kind: 'http', status: 403, body: googleError(403, 'PERMISSION_DENIED') },
      [KEY_B]: { kind: 'http', status: 403, body: googleError(403, 'PERMISSION_DENIED') },
    };
    const r = await chat('detect');
    expect(r).toEqual({ status: 200, body: { reply: HELP_FALLBACK, newState: DONE_STATE } });
    expect(calls).toHaveLength(4); // aucun appel ajouté
    expect(geminiLogs('failed')).toHaveLength(4);
    expect(geminiLogs('all_keys_failed').map((l) => l.flow)).toEqual(['intent', 'reply']);
  });
});

describe('pool vide', () => {
  it('aucune clé → aucun appel, aucune trace, repli inchangé', async () => {
    pool = [];
    const r = await chat('detect');
    expect(r).toEqual({ status: 200, body: { reply: HELP_FALLBACK, newState: DONE_STATE } });
    expect(calls).toHaveLength(0);
    expect(geminiLogs()).toHaveLength(0);
  });
});

describe('sécurité des journaux', () => {
  it.each(FAILURES)(
    '$name → ni clé, fragment, key=, URL, corps Google, exception, prompt ni données client',
    async (f) => {
      outcomes = { [KEY_A]: f.out, [KEY_B]: f.out };
      await chat('detect');
      expect(geminiLogs('failed').length).toBeGreaterThan(0);
      const all = logLines().join('\n');
      for (const forbidden of [
        KEY_A,
        KEY_B,
        KEY_A.slice(0, 12),
        KEY_B.slice(-10),
        'AIza',
        'key=',
        'generativelanguage',
        'googleapis',
        'generateContent',
        'ECONNRESET',
        'undici',
        'Request to',
        'projects/123456789',
        'Classe ce message',
        'Tu es l',
        'Amine',
        'Bensalah',
        '0550000001',
        'Oran',
        'Authorization',
        'not json',
      ]) {
        expect(all).not.toContain(forbidden);
      }
    }
  );
});

describe('gemini-error.ts — compatibilité WhatsApp / Messenger', () => {
  it('sans flow (WhatsApp, Messenger) → aucun champ flow dans les traces', async () => {
    const { logGeminiKeyFailure, logGeminiPoolExhausted } =
      await import('@/lib/ai-chatbot/gemini-error');
    logGeminiKeyFailure({ channel: 'whatsapp', tenantId: T }, 1, 2, {
      error_code: 'network_error',
    });
    logGeminiPoolExhausted({ channel: 'messenger', tenantId: T }, 2);
    const logs = geminiLogs();
    expect(logs).toHaveLength(2);
    for (const l of logs) expect(l).not.toHaveProperty('flow');
    expect(logs.map((l) => [l.channel, l.status])).toEqual([
      ['whatsapp', 'failed'],
      ['messenger', 'all_keys_failed'],
    ]);
  });
});
