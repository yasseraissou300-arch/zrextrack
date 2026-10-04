// P4 — Échecs Gemini (pool de clés BYOK) : plus jamais silencieux ni ambigus.
//
// CONSTAT (code) :
//   - WhatsApp (callGemini / callAI) : un statut ≠ 2xx produisait
//     `ai.gemini {status:'http_error', error_code:'<statut>'}` SANS tenant, SANS
//     rang de clé, SANS catégorie ; une exception `{status:'exception'}` sans
//     code ; une réponse 200 sans texte (bloquée, vide) passait à la clé
//     suivante SANS aucune trace ; l'épuisement du pool n'était qu'un
//     console.log.
//   - Messenger (callGeminiPool) : TOUT échec était silencieux
//     (`if (!res.ok) continue`, catch vide).
// Correction attendue : OBSERVABILITÉ SEULE. Par clé en échec :
//   ai.gemini {status:'failed', channel, tenant_id, key_index, pool_size,
//              http_status?, error_code (catégorie), finish_reason?, ref}
// puis, si aucune clé n'a répondu : ai.gemini {status:'all_keys_failed', …}.
// La clé est dans l'URL : jamais la clé, un fragment, `key=`, l'URL, le corps
// Gemini, le message d'exception, le prompt ni la conversation.
// Le fallback (ordre, une tentative par clé, clé suivante quel que soit
// l'échec) et les réponses au client restent IDENTIQUES.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
let pool: string[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => db,
}));
vi.mock('@/lib/user-creds', () => ({
  resolveGeminiKeys: async () => pool,
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'evo-key' }),
}));

const T = '11111111-1111-4111-8111-111111111111';
const CLIENT = '213550000001';
const PSID = '6123456789012345';
const KEY_A = 'AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvW';
const KEY_B = 'AIzaSyZ9y8X7w6V5u4T3s2R1q0PoNmLkJiHgFeD';
const USER_TEXT = 'Ana Amine Bensalah, nheb montre l-kahla, 0550000001';
const REPLY = 'Mliha, wach smitek kamel ?';
const AI_ERROR_MSG = 'Smahli, kayen mushkil t9ani. 3awed 7awel ba3d chwiya.';

type Outcome =
  | { kind: 'ok' }
  | { kind: 'http'; status: number; body: string }
  | { kind: 'network' }
  | { kind: 'empty'; finishReason?: string };
let outcomes: Record<string, Outcome> = {};
/** Ordre des clés réellement appelées, en RANG (jamais la valeur). */
const geminiCalls: number[] = [];
const evo: Array<{ number: string; text: string }> = [];
const graph: string[] = [];

const keyFromUrl = (url: string) => new URL(url).searchParams.get('key') ?? '';
const geminiUrl = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

/** Corps d'erreur Google réaliste (avec URL et clé, pour prouver qu'ils ne fuient pas). */
const googleError = (code: number, status: string, reason?: string, key = KEY_A) =>
  JSON.stringify({
    error: {
      code,
      message: `Request to ${geminiUrl(key)} failed: ${status}. Prompt: "${USER_TEXT}"`,
      status,
      ...(reason
        ? {
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason,
                domain: 'googleapis.com',
                metadata: {
                  service: 'generativelanguage.googleapis.com',
                  consumer: 'projects/123456789',
                },
              },
            ],
          }
        : {}),
    },
  });

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    const key = keyFromUrl(url);
    geminiCalls.push(pool.indexOf(key) + 1);
    const out = outcomes[key] ?? { kind: 'ok' };
    if (out.kind === 'network') {
      const e = new TypeError(`fetch failed: request to ${url} failed, reason: ECONNRESET`);
      e.stack = `TypeError: fetch failed ${url}\n    at node:internal/deps/undici`;
      throw e;
    }
    if (out.kind === 'http') return new Response(out.body, { status: out.status });
    if (out.kind === 'empty') {
      return Response.json({
        candidates: [{ content: { parts: [] }, finishReason: out.finishReason ?? 'SAFETY' }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
      });
    }
    return Response.json({
      candidates: [{ content: { parts: [{ text: REPLY }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    });
  }
  if (url.startsWith('https://evolution.test/message/')) {
    evo.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 201 });
  }
  if (url.startsWith('https://graph.facebook.com/')) {
    graph.push(JSON.parse(String(init?.body)).message.text);
    return new Response('{}');
  }
  return new Response('{}');
});

let seq = 0;
async function whatsapp(text = USER_TEXT) {
  const { POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route');
  const res = await POST(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'zrex_t_auto',
        data: {
          key: { remoteJid: `${CLIENT}@s.whatsapp.net`, fromMe: false, id: `W-${++seq}` },
          message: { conversation: text },
          pushName: 'Amine Bensalah',
        },
      }),
    })
  );
  return { status: res.status, body: await res.json() };
}
async function messenger(text = USER_TEXT) {
  const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
  const res = await POST(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/facebook', {
      method: 'POST',
      body: JSON.stringify({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [{ sender: { id: PSID }, message: { mid: `m-${++seq}`, text } }],
          },
        ],
      }),
    })
  );
  return { status: res.status, body: await res.json() };
}
const CHANNELS = {
  whatsapp: { send: whatsapp, replies: () => evo.map((e) => e.text) },
  messenger: { send: messenger, replies: () => graph },
} as const;
type Channel = keyof typeof CHANNELS;

function logLines(): string[] {
  return (['log', 'info', 'warn', 'error'] as const).flatMap((m) =>
    (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      c.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' ')
    )
  );
}
const geminiLogs = (status: string) =>
  logLines()
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.scope === 'ai.gemini' && l.status === status);

/** Session existante (le premier message « salam » de WhatsApp n'appelle pas l'IA). */
function sessions() {
  db.seed('public', 'ai_chat_sessions', [
    {
      user_id: T,
      channel: 'whatsapp',
      contact_id: `${CLIENT}@s.whatsapp.net`,
      template_type: 'auto_confirmation',
      conversation: [
        { role: 'user', content: 'salam' },
        { role: 'assistant', content: 'Ahlan' },
      ],
      extracted_data: {},
      is_complete: false,
      sheets_sent: false,
      human_handover: false,
      relance_sent: false,
      failure_count: 0,
      tokens_used: 0,
      updated_at: new Date().toISOString(),
    },
    { user_id: T, channel: 'facebook', contact_id: PSID, conversation: [] },
  ]);
}

beforeEach(() => {
  db = new FakeSupabase();
  pool = [KEY_A, KEY_B];
  outcomes = {};
  geminiCalls.length = 0;
  evo.length = 0;
  graph.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FACEBOOK_APP_SECRET', '');
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  db.seed('public', 'whatsapp_instances', [
    {
      user_id: T,
      service_type: 'auto_confirmation',
      instance_name: 'zrex_t_auto',
      connected: true,
    },
  ]);
  db.seed('public', 'profiles', [{ id: T, whatsapp_warmup_started_at: null }]);
  db.seed('public', 'facebook_connections', [
    { user_id: T, page_id: 'page-1', page_access_token: 'tok' },
  ]);
  db.seed('public', 'chatbot_configs', [
    {
      user_id: T,
      template_type: 'auto_confirmation',
      is_active: true,
      google_sheets_url: '',
      admin_whatsapp: '',
      shop_name: 'Boutique',
      custom_prompt: null,
      media_url: null,
      blocked_prefixes: [],
    },
  ]);
  sessions();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const FAILURES: Array<{
  name: string;
  out: Outcome;
  code: string;
  http?: number;
  finish?: string;
}> = [
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
    out: {
      kind: 'http',
      status: 503,
      body: `<html>Service Unavailable ${geminiUrl(KEY_A)}</html>`,
    },
    code: 'provider_error',
    http: 503,
  },
  { name: 'exception réseau', out: { kind: 'network' }, code: 'network_error' },
  {
    name: '200 sans texte (SAFETY)',
    out: { kind: 'empty', finishReason: 'SAFETY' },
    code: 'empty_response',
    http: 200,
    finish: 'SAFETY',
  },
];

describe.each(Object.keys(CHANNELS) as Channel[])('%s', (channel) => {
  const ch = CHANNELS[channel];

  it('A — clé valide → réponse envoyée, 1 appel, aucune trace d’échec', async () => {
    pool = [KEY_A];
    await ch.send();
    expect(geminiCalls).toEqual([1]);
    expect(ch.replies()).toEqual([REPLY]);
    expect(geminiLogs('failed')).toHaveLength(0);
    expect(geminiLogs('all_keys_failed')).toHaveLength(0);
  });

  it.each(FAILURES)(
    '$name sur la clé 1 → trace sûre, clé 2 essayée, réponse inchangée',
    async (f) => {
      outcomes = { [KEY_A]: f.out };
      const r = await ch.send();
      expect(r).toEqual({ status: 200, body: { ok: true } });
      expect(geminiCalls).toEqual([1, 2]); // fallback inchangé, aucun retry
      expect(ch.replies()).toEqual([REPLY]);
      const fails = geminiLogs('failed');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        level: 'warn',
        channel,
        tenant_id: T,
        key_index: 1,
        pool_size: 2,
        error_code: f.code,
      });
      if (f.http) expect(fails[0].http_status).toBe(f.http);
      else expect(fails[0].http_status).toBeUndefined();
      if (f.finish) expect(fails[0].finish_reason).toBe(f.finish);
      expect(String(fails[0].ref)).toMatch(/^E-[0-9a-f]{8}$/);
      expect(geminiLogs('all_keys_failed')).toHaveLength(0);
    }
  );

  it('I — toutes les clés échouent → 2 traces + all_keys_failed, comportement client inchangé', async () => {
    outcomes = {
      [KEY_A]: { kind: 'http', status: 429, body: googleError(429, 'RESOURCE_EXHAUSTED') },
      [KEY_B]: { kind: 'network' },
    };
    const r = await ch.send();
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(geminiCalls).toEqual([1, 2]);
    // Comportement ACTUEL conservé : WhatsApp envoie le message d'erreur
    // générique ; Messenger n'envoie rien.
    expect(ch.replies()).toEqual(channel === 'whatsapp' ? [AI_ERROR_MSG] : []);
    expect(geminiLogs('failed').map((l) => [l.key_index, l.error_code])).toEqual([
      [1, 'rate_limited'],
      [2, 'network_error'],
    ]);
    const all = geminiLogs('all_keys_failed');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ level: 'warn', channel, tenant_id: T, pool_size: 2 });
  });

  it('pool vide → aucun appel Gemini, aucune trace « failed », comportement inchangé', async () => {
    pool = [];
    await ch.send();
    expect(geminiCalls).toHaveLength(0);
    expect(geminiLogs('failed')).toHaveLength(0);
    expect(geminiLogs('all_keys_failed')).toHaveLength(0);
    // Comportement ACTUEL : WhatsApp journalise no_key_configured et envoie le
    // message d'erreur générique ; Messenger ne répond pas.
    expect(ch.replies()).toEqual(channel === 'whatsapp' ? [AI_ERROR_MSG] : []);
  });

  it('journal sûr : ni clé, fragment, key=, URL Gemini, corps, message d’exception, prompt ni PII', async () => {
    outcomes = {
      [KEY_A]: {
        kind: 'http',
        status: 400,
        body: googleError(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID'),
      },
      [KEY_B]: { kind: 'network' },
    };
    await ch.send();
    expect(geminiLogs('failed')).toHaveLength(2);
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
      'projects/123456789',
      'Request to',
      'Amine',
      'Bensalah',
      'montre',
      '0550000001',
      PSID,
      'NOM_BOUTIQUE',
      'Authorization',
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });
});

describe('aucun effet métier', () => {
  it('WhatsApp : échec de la clé 1 → même session, aucune ligne messages, sheets_sent intact', async () => {
    outcomes = { [KEY_A]: { kind: 'http', status: 500, body: googleError(500, 'INTERNAL') } };
    await whatsapp();
    const s = db.all('public', 'ai_chat_sessions').find((x) => x.channel === 'whatsapp');
    expect(s?.failure_count).toBe(0);
    expect(s?.sheets_sent).toBe(false);
    expect(db.all('public', 'messages')).toHaveLength(0);
  });
});
