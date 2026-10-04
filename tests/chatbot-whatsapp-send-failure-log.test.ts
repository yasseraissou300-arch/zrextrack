// P4 — Échec d'envoi WhatsApp du chatbot et de l'alerte admin : plus jamais SILENCIEUX.
//
// CONSTAT (code) : sendWhatsApp / sendWhatsAppMedia du webhook chatbot
// ignoraient le statut HTTP d'Evolution et avalaient toute exception. Une
// réponse au client ou une alerte admin perdue ne laissait AUCUNE trace.
//
// Correction attendue : OBSERVABILITÉ SEULE. Journal sûr
//   scope 'chatbot.whatsapp', level warn, status 'failed', channel 'whatsapp',
//   flow, tenant_id, http_status + error_code (catégorie) OU error_code, ref.
// Jamais : téléphone, nom, contenu, clé, URL Evolution, URL de média, corps
// d'Evolution. Aucun changement métier : mêmes envois, aucun retry, aucune
// écriture supplémentaire, même réponse HTTP au webhook.
//
// Harnais : webhook WhatsApp réel, base en mémoire, Gemini / Evolution simulés.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => db,
}));
vi.mock('@/lib/user-creds', () => ({
  resolveGeminiKeys: async () => ['gemini-test-key'],
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'evo-secret-key' }),
}));

const T = '11111111-1111-4111-8111-111111111111';
const CLIENT = '213550000001';
const ADMIN = '213660000009';
const MEDIA = 'https://cdn.test/private/produit.jpg?token=abc';
const COMPLETE =
  'Sajjelna commande ✅ <data>{"nom":"Amine Bensalah","telephone":"0550000001","wilaya":"wahran","produit":"Montre"}</data>';
const EVO_ERROR_BODY =
  '{"status":500,"error":"Invalid prisma.message.create() number 213550000001 text Montre"}';

type Outcome = number | 'network';
let geminiReply = '';
/** Réponse d'Evolution selon (endpoint, destinataire). Défaut : 201. */
let evoRule: (endpoint: 'sendText' | 'sendMedia', number: string) => Outcome = () => 201;
const evo: Array<{ endpoint: string; number: string }> = [];

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('https://evolution.test/message/')) {
    const endpoint = url.includes('/sendMedia/') ? 'sendMedia' : 'sendText';
    const number = String(JSON.parse(String(init?.body)).number);
    evo.push({ endpoint, number });
    const out = evoRule(endpoint, number);
    if (out === 'network') throw new TypeError('fetch failed');
    return new Response(out < 300 ? '{"key":{"id":"x"}}' : EVO_ERROR_BODY, { status: out });
  }
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    return Response.json({
      candidates: [{ content: { parts: [{ text: geminiReply }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
  }
  return new Response('{}');
});

let seq = 0;
async function inbound(text: string, reply = 'Wach smitek ?') {
  geminiReply = reply;
  const { POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route');
  const res = await POST(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'zrex_t_auto',
        data: {
          key: { remoteJid: `${CLIENT}@s.whatsapp.net`, fromMe: false, id: `R-${++seq}` },
          message: { conversation: text },
          pushName: 'Amine Bensalah',
        },
      }),
    })
  );
  return { status: res.status, body: await res.json() };
}

function logLines(): string[] {
  return (['log', 'info', 'warn', 'error'] as const).flatMap((m) =>
    (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
  );
}
const sendFailures = () =>
  logLines()
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.scope === 'chatbot.whatsapp' && l.status === 'failed');

function config(extra: Record<string, unknown> = {}) {
  db.seed('public', 'chatbot_configs', [
    {
      user_id: T,
      template_type: 'auto_confirmation',
      is_active: true,
      google_sheets_url: '',
      admin_whatsapp: ADMIN,
      shop_name: 'Boutique',
      custom_prompt: null,
      media_url: null,
      blocked_prefixes: [],
      ...extra,
    },
  ]);
}

/** Session existante (évite le message de bienvenue et le « nudge » du 1er contact). */
function existingSession() {
  db.seed('public', 'ai_chat_sessions', [
    {
      user_id: T,
      channel: 'whatsapp',
      contact_id: `${CLIENT}@s.whatsapp.net`,
      template_type: 'auto_confirmation',
      conversation: [
        { role: 'user', content: 'nheb montre' },
        { role: 'assistant', content: 'Wach smitek ?' },
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
  ]);
}

beforeEach(() => {
  db = new FakeSupabase();
  geminiReply = '';
  evoRule = () => 201;
  evo.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  db.seed('public', 'whatsapp_instances', [
    { user_id: T, service_type: 'auto_confirmation', instance_name: 'zrex_t_auto', connected: true },
  ]);
  db.seed('public', 'profiles', [{ id: T, whatsapp_warmup_started_at: null }]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OUTCOMES: Outcome[] = [400, 401, 403, 429, 500, 'network'];
const KIND: Record<number, string> = {
  400: 'rejected',
  401: 'unauthorized',
  403: 'unauthorized',
  429: 'rate_limited',
  500: 'server_error',
};

function expectFailure(log: Record<string, unknown>, flow: string, out: Outcome) {
  expect(log).toMatchObject({
    level: 'warn',
    scope: 'chatbot.whatsapp',
    status: 'failed',
    channel: 'whatsapp',
    flow,
    tenant_id: T,
  });
  expect(String(log.ref)).toMatch(/^E-[0-9a-f]{8}$/);
  if (out === 'network') {
    expect(log.error_code).toBe('TypeError');
    expect(log.http_status).toBeUndefined();
  } else {
    expect(log.http_status).toBe(out);
    expect(log.error_code).toBe(KIND[out]);
  }
}

// ─── A. Réponse texte du chatbot ────────────────────────────────────────────

describe('A — réponse texte (flow reply)', () => {
  it('201 → envoyée, aucun journal d’échec', async () => {
    config();
    existingSession();
    await inbound('nheb montre noire', 'Mliha, wach smitek ?');
    expect(evo).toEqual([{ endpoint: 'sendText', number: CLIENT }]);
    expect(sendFailures()).toHaveLength(0);
  });

  it.each(OUTCOMES)('%s → journal failed (reply), aucun retry, webhook 200 {ok:true}', async (out) => {
    config();
    existingSession();
    evoRule = () => out;
    const r = await inbound('nheb montre noire', 'Mliha, wach smitek ?');
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(evo).toHaveLength(1); // aucun retry
    const f = sendFailures();
    expect(f).toHaveLength(1);
    expectFailure(f[0], 'reply', out);
  });
});

// ─── B/D. Média de bienvenue ────────────────────────────────────────────────

describe('B/D — média de bienvenue (flow welcome_media)', () => {
  it('201 → aucun journal', async () => {
    config({ media_url: MEDIA });
    await inbound('nheb nchri montre', 'Wach smitek ?');
    expect(evo.map((e) => e.endpoint)).toEqual(['sendMedia', 'sendText']);
    expect(sendFailures()).toHaveLength(0);
  });

  it.each(OUTCOMES)('%s → journal failed (welcome_media) ; la réponse texte part quand même', async (out) => {
    config({ media_url: MEDIA });
    evoRule = (endpoint) => (endpoint === 'sendMedia' ? out : 201);
    await inbound('nheb nchri montre', 'Wach smitek ?');
    expect(evo.map((e) => e.endpoint)).toEqual(['sendMedia', 'sendText']);
    const f = sendFailures();
    expect(f).toHaveLength(1);
    expectFailure(f[0], 'welcome_media', out);
  });
});

// ─── C. Passage à un humain, « nudge », erreur IA ───────────────────────────

describe('C — messages automatiques', () => {
  it.each([500, 'network'] as Outcome[])('handover (colère) %s → journal failed (handover)', async (out) => {
    config();
    existingSession();
    evoRule = () => out;
    await inbound('ndir plainte 3likom');
    const f = sendFailures();
    expect(f).toHaveLength(1);
    expectFailure(f[0], 'handover', out);
    // Comportement métier inchangé : la session passe quand même en handover.
    expect(db.all('public', 'ai_chat_sessions')[0].human_handover).toBe(true);
  });

  it.each([500, 'network'] as Outcome[])('nudge (1er message « salam ») %s → journal failed (nudge)', async (out) => {
    config();
    evoRule = () => out;
    await inbound('salam');
    const f = sendFailures();
    expect(f).toHaveLength(1);
    expectFailure(f[0], 'nudge', out);
  });

  it.each([500, 'network'] as Outcome[])('erreur IA (réponse vide) %s → journal failed (ai_error)', async (out) => {
    config();
    existingSession();
    evoRule = () => out;
    await inbound('nheb montre noire', '');
    const f = sendFailures();
    expect(f).toHaveLength(1);
    expectFailure(f[0], 'ai_error', out);
  });

  it('handover / nudge en 201 → aucun journal', async () => {
    config();
    await inbound('salam');
    existingSession();
    await inbound('ndir plainte 3likom');
    expect(sendFailures()).toHaveLength(0);
  });
});

// ─── E. Alerte admin ────────────────────────────────────────────────────────

describe('E — alerte admin (flow admin_alert)', () => {
  it('201 → alerte envoyée, aucun journal', async () => {
    config();
    existingSession();
    await inbound('Amine Bensalah, 0550000001, wahran', COMPLETE);
    expect(evo.filter((e) => e.number === ADMIN)).toHaveLength(1);
    expect(sendFailures()).toHaveLength(0);
  });

  it.each(OUTCOMES)('%s → journal failed (admin_alert) ; réponse client et sheets_sent inchangés', async (out) => {
    config();
    existingSession();
    evoRule = (_e, number) => (number === ADMIN ? out : 201);
    await inbound('Amine Bensalah, 0550000001, wahran', COMPLETE);
    expect(evo.map((e) => e.number)).toEqual([ADMIN, CLIENT]); // aucun retry
    const f = sendFailures();
    expect(f).toHaveLength(1);
    expectFailure(f[0], 'admin_alert', out);
    expect(db.all('public', 'ai_chat_sessions')[0].sheets_sent).toBe(true);
  });
});

// ─── Sécurité du journal et absence d'effet métier ──────────────────────────

describe('journal sûr, aucun effet métier', () => {
  it('le journal ne contient ni téléphone, nom, contenu, clé, URL Evolution, URL de média, ni corps Evolution', async () => {
    config({ media_url: MEDIA });
    evoRule = () => 500;
    await inbound('nheb nchri montre', 'Wach smitek ?');
    existingSession();
    await inbound('Amine Bensalah, 0550000001, wahran', COMPLETE);
    expect(sendFailures().length).toBeGreaterThanOrEqual(3);
    const failures = JSON.stringify(sendFailures());
    for (const forbidden of [
      CLIENT,
      '550000001',
      ADMIN,
      'Amine',
      'Bensalah',
      'Montre',
      'Wach smitek',
      'Sajjelna',
      'evo-secret-key',
      'apikey',
      'evolution.test',
      'cdn.test',
      'token=abc',
      'prisma',
      'zrex_t_auto',
    ]) {
      expect(failures).not.toContain(forbidden);
    }
  });

  it('aucune écriture métier ajoutée : messages vide, aucun retry, même nombre d’appels qu’en succès', async () => {
    config();
    existingSession();
    await inbound('nheb montre noire', 'Mliha');
    const okCalls = evo.length;
    evo.length = 0;
    db = new FakeSupabase();
    db.seed('public', 'whatsapp_instances', [
      { user_id: T, service_type: 'auto_confirmation', instance_name: 'zrex_t_auto', connected: true },
    ]);
    db.seed('public', 'profiles', [{ id: T, whatsapp_warmup_started_at: null }]);
    config();
    existingSession();
    evoRule = () => 500;
    await inbound('nheb montre noire', 'Mliha');
    expect(evo.length).toBe(okCalls);
    expect(db.all('public', 'messages')).toHaveLength(0);
  });
});
