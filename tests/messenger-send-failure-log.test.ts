// P4 — Échec d'envoi Messenger (sendFBMessage) : plus jamais SILENCIEUX.
//
// CONSTAT (code) : sendFBMessage ignorait le statut HTTP de la Graph API et
// avalait toute exception (catch vide). Une réponse au client perdue (jeton de
// page expiré, permission retirée, limite de débit, panne) ne laissait AUCUNE
// trace. Seul envoi sortant Messenger : la réponse texte (flow reply). Pas de
// média, de bienvenue, de handover, de « nudge » ni de message d'erreur IA sur
// ce canal (IA sans réponse → `continue`, rien n'est envoyé).
//
// Correction attendue : OBSERVABILITÉ SEULE. Journal sûr
//   scope 'chatbot.messenger', level warn, status 'failed', channel 'messenger',
//   flow 'reply', tenant_id, http_status + error_code (catégorie Graph) [+
//   graph_code numérique] OU error_code de l'exception, ref.
// Le jeton de page est dans l'URL Graph : jamais l'URL, jamais le jeton, jamais
// le corps Graph, ni le PSID, le nom, le contenu.

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
  resolveEvolutionCreds: async () => ({ url: '', key: '' }),
}));

const TENANT = '11111111-1111-4111-8111-111111111111';
const PAGE = 'page-1';
const PSID = '6123456789012345';
const PAGE_TOKEN = 'EAABsbCS1iHgBAPageTokenSecret123';
const REPLY = 'Mliha Amine, wach tebghi montre l-kahla ?';

type Outcome = number | 'network';
let graphOutcome: Outcome = 200;
let graphBody = '{"recipient_id":"x","message_id":"m"}';
const graphCalls: string[] = [];
let geminiReply = REPLY;

const fetchMock = vi.fn(async (input: string) => {
  const url = String(input);
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    return Response.json({ candidates: [{ content: { parts: [{ text: geminiReply }] } }] });
  }
  if (url.startsWith('https://graph.facebook.com/')) {
    graphCalls.push(url);
    if (graphOutcome === 'network') {
      // Message d'erreur réaliste contenant l'URL (et donc le jeton).
      throw new TypeError(`fetch failed for ${url}`);
    }
    return new Response(graphBody, { status: graphOutcome });
  }
  return new Response('{}');
});

let seq = 0;
async function post(text = 'nheb montre') {
  const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
  const res = await POST(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/facebook', {
      method: 'POST',
      body: JSON.stringify({
        object: 'page',
        entry: [
          { id: PAGE, messaging: [{ sender: { id: PSID }, message: { mid: `m-${++seq}`, text } }] },
        ],
      }),
    })
  );
  return { status: res.status, body: await res.json() };
}

function logLines(): string[] {
  return (['log', 'info', 'warn', 'error'] as const).flatMap((m) =>
    (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      c.map(String).join(' ')
    )
  );
}
const sendFailures = () =>
  logLines()
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.scope === 'chatbot.messenger' && l.status === 'failed');

/** Corps d'erreur Graph réaliste : contient PSID, contenu et trace interne. */
const graphError = (code: number, sub?: number) =>
  JSON.stringify({
    error: {
      message: `(#${code}) Error for recipient ${PSID}: "${REPLY}"`,
      type: 'OAuthException',
      code,
      ...(sub ? { error_subcode: sub } : {}),
      fbtrace_id: 'AbCdEfGhIjK',
    },
  });

const CASES: Array<{ out: Outcome; body: string; kind: string; graph_code?: number }> = [
  { out: 400, body: graphError(100), kind: 'rejected', graph_code: 100 },
  { out: 401, body: graphError(190, 463), kind: 'token_invalid', graph_code: 190 },
  { out: 403, body: graphError(10), kind: 'permission_denied', graph_code: 10 },
  { out: 429, body: graphError(613), kind: 'rate_limited', graph_code: 613 },
  { out: 500, body: graphError(2), kind: 'server_error', graph_code: 2 },
  { out: 'network', body: '', kind: 'TypeError' },
];

beforeEach(() => {
  db = new FakeSupabase();
  graphOutcome = 200;
  graphBody = '{"recipient_id":"x","message_id":"m"}';
  graphCalls.length = 0;
  geminiReply = REPLY;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FACEBOOK_APP_SECRET', ''); // signature non appliquée (testée ailleurs)
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  db.seed('public', 'facebook_connections', [
    { user_id: TENANT, page_id: PAGE, page_access_token: PAGE_TOKEN },
  ]);
  db.seed('public', 'chatbot_configs', [
    {
      user_id: TENANT,
      is_active: true,
      template_type: 'auto_confirmation',
      google_sheets_url: '',
      custom_prompt: null,
    },
  ]);
  db.seed('public', 'ai_chat_sessions', [
    { user_id: TENANT, channel: 'facebook', contact_id: PSID, conversation: [] },
  ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Messenger — réponse texte (flow reply)', () => {
  it('200 → envoyée une fois, aucun journal d’échec, webhook 200 {ok:true}', async () => {
    const r = await post();
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(graphCalls).toHaveLength(1);
    expect(sendFailures()).toHaveLength(0);
  });

  it('200 avec un corps d’erreur Graph → reste un succès (aucune preuve d’échec, documenté)', async () => {
    graphBody = graphError(100);
    await post();
    expect(sendFailures()).toHaveLength(0);
  });

  it.each(CASES)('$out → UN journal failed, aucun retry, webhook inchangé', async (c) => {
    graphOutcome = c.out;
    graphBody = c.body;
    const r = await post();
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(graphCalls).toHaveLength(1); // aucun retry
    const f = sendFailures();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      level: 'warn',
      scope: 'chatbot.messenger',
      status: 'failed',
      channel: 'messenger',
      flow: 'reply',
      tenant_id: TENANT,
      error_code: c.kind,
    });
    expect(String(f[0].ref)).toMatch(/^E-[0-9a-f]{8}$/);
    if (c.out === 'network') {
      expect(f[0].http_status).toBeUndefined();
      expect(f[0].graph_code).toBeUndefined();
    } else {
      expect(f[0].http_status).toBe(c.out);
      expect(f[0].graph_code).toBe(c.graph_code);
    }
  });

  it('corps Graph illisible (HTML de proxy) → catégorie selon le seul statut HTTP', async () => {
    graphOutcome = 502;
    graphBody = `<html>Bad gateway graph.facebook.com access_token=${PAGE_TOKEN}</html>`;
    await post();
    const f = sendFailures();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ http_status: 502, error_code: 'server_error' });
    expect(f[0].graph_code).toBeUndefined();
  });
});

describe('journal sûr, aucun effet métier', () => {
  it.each(CASES)(
    '$out → aucun jeton, URL, PSID, nom, contenu ni corps Graph dans les journaux',
    async (c) => {
      graphOutcome = c.out;
      graphBody = c.body;
      await post('Ana Amine Bensalah, nheb montre');
      expect(sendFailures()).toHaveLength(1);
      const all = logLines().join('\n');
      for (const forbidden of [
        PAGE_TOKEN,
        'EAAB',
        'access_token',
        'graph.facebook.com',
        'v18.0/me/messages',
        PSID,
        'Amine',
        'Bensalah',
        'montre',
        'Mliha',
        'OAuthException',
        'fbtrace',
        'AbCdEfGhIjK',
        'Error for recipient',
        'Authorization',
      ]) {
        expect(all).not.toContain(forbidden);
      }
    }
  );

  it('aucune écriture métier ajoutée : même session qu’en succès, messages vide, sheets_sent inchangé', async () => {
    await post();
    const ok = structuredClone(db.all('public', 'ai_chat_sessions')[0]);
    db = new FakeSupabase();
    db.seed('public', 'facebook_connections', [
      { user_id: TENANT, page_id: PAGE, page_access_token: PAGE_TOKEN },
    ]);
    db.seed('public', 'chatbot_configs', [
      {
        user_id: TENANT,
        is_active: true,
        template_type: 'auto_confirmation',
        google_sheets_url: '',
        custom_prompt: null,
      },
    ]);
    db.seed('public', 'ai_chat_sessions', [
      { user_id: TENANT, channel: 'facebook', contact_id: PSID, conversation: [] },
    ]);
    graphOutcome = 500;
    graphBody = graphError(2);
    await post();
    const failed = db.all('public', 'ai_chat_sessions')[0];
    expect(failed.conversation).toEqual(ok.conversation);
    expect(failed.sheets_sent).toEqual(ok.sheets_sent);
    expect(failed.is_complete).toEqual(ok.is_complete);
    expect(db.all('public', 'messages')).toHaveLength(0);
  });
});
