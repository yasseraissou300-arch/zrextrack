// P4 — Sémantique ACTUELLE de ai_chat_sessions.sheets_sent (CONSTAT, aucun code modifié).
//
// Question posée : sheets_sent = true signifie-t-il « commande transmise avec
// succès à Google Sheets » ? Ces tests décrivent ce que le code FAIT (branche
// p4-sheets-notify-log = pile 1→12l + f3467f3 + 8ab3a25), sans juger la règle.
// La décision produit est consignée au BACKLOG (D).
//
// Harnais repris de tests/chatbot-sheets-notify.test.ts (webhook réel, base en
// mémoire, Gemini / Evolution / Sheets / Graph factices, aucun envoi réel).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => db,
}));
vi.mock('@/lib/user-creds', () => ({
  resolveGeminiKeys: async () => ['gemini-test-key'],
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'global-key' }),
}));

const T = '11111111-1111-4111-8111-111111111111';
const C = '213550000001@s.whatsapp.net';
const PAGE = 'page-1';
const SENDER = 'psid-1';
const SHEETS = 'https://sheets.test/hook';
const COMPLETE =
  'Sajjelna commande ✅ <data>{"nom":"Amine B","telephone":"0550123456","wilaya":"wahran","produit":"Montre"}</data>';

let geminiReply = '';
let sheetsOutcome: number | 'network' = 200;
const sheetsCalls: Array<{ sheetsSentAtCall: unknown; signal: unknown }> = [];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    return Response.json({
      candidates: [{ content: { parts: [{ text: geminiReply }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
  }
  if (url === SHEETS) {
    // Valeur de sheets_sent EN BASE au moment précis de l'appel au Sheet.
    sheetsCalls.push({
      sheetsSentAtCall: db.all('public', 'ai_chat_sessions')[0]?.sheets_sent,
      signal: init?.signal,
    });
    if (sheetsOutcome === 'network') throw new TypeError('fetch failed');
    return new Response(sheetsOutcome === 200 ? 'ok' : 'err', { status: sheetsOutcome });
  }
  return new Response('{}');
});

let WA: (req: NextRequest) => Promise<Response>;
let FB: (req: NextRequest) => Promise<Response>;
beforeAll(async () => {
  ({ POST: WA } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route'));
  ({ POST: FB } = await import('@/app/api/ai-chatbot/webhook/facebook/route'));
});

let seq = 0;
async function wa(text: string, reply: string) {
  geminiReply = reply;
  return WA(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'zrex_t_auto',
        data: {
          key: { remoteJid: C, fromMe: false, id: `R-${++seq}` },
          message: { conversation: text },
          pushName: 'Client',
        },
      }),
    })
  );
}
async function fb(text: string, reply: string) {
  geminiReply = reply;
  return FB(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/facebook', {
      method: 'POST',
      body: JSON.stringify({
        object: 'page',
        entry: [
          { id: PAGE, messaging: [{ sender: { id: SENDER }, message: { mid: `m-${++seq}`, text } }] },
        ],
      }),
    })
  );
}
async function waOrder() {
  await wa('nheb montre', 'Wach smitek ?');
  await wa('Amine B, 0550123456, wahran', COMPLETE);
}

const session = (channel = 'whatsapp') =>
  db.all('public', 'ai_chat_sessions').find((s) => s.channel === channel);
const sheetsFailures = () =>
  (['log', 'info', 'warn', 'error'] as const)
    .flatMap((m) =>
      (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    )
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.scope === 'chatbot.sheets' && l.status === 'failed');

function config(extra: Record<string, unknown> = {}) {
  db.seed('public', 'chatbot_configs', [
    {
      user_id: T,
      template_type: 'auto_confirmation',
      is_active: true,
      google_sheets_url: SHEETS,
      admin_whatsapp: '',
      shop_name: 'Boutique',
      custom_prompt: null,
      media_url: null,
      blocked_prefixes: [],
      ...extra,
    },
  ]);
}

beforeEach(() => {
  db = new FakeSupabase();
  geminiReply = '';
  sheetsOutcome = 200;
  sheetsCalls.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FACEBOOK_APP_SECRET', '');
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  db.seed('public', 'whatsapp_instances', [
    { user_id: T, service_type: 'auto_confirmation', instance_name: 'zrex_t_auto', connected: true },
  ]);
  db.seed('public', 'profiles', [{ id: T, whatsapp_warmup_started_at: null }]);
  db.seed('public', 'facebook_connections', [
    { user_id: T, page_id: PAGE, page_access_token: 'tok' },
  ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('WhatsApp — sheets_sent selon la réponse du Sheet', () => {
  it.each([200, 400, 401, 403, 429, 500, 'network'] as const)(
    'Sheet → %s : sheets_sent = true ; journal failed seulement si ≠ 200',
    async (outcome) => {
      config();
      sheetsOutcome = outcome;
      await waOrder();
      expect(sheetsCalls).toHaveLength(1);
      expect(session()?.sheets_sent).toBe(true);
      expect(sheetsFailures()).toHaveLength(outcome === 200 ? 0 : 1);
      if (typeof outcome === 'number' && outcome !== 200) {
        expect(sheetsFailures()[0].http_status).toBe(outcome);
      }
    }
  );

  it('ORDRE : sheets_sent est DÉJÀ true en base au moment de l’appel au Sheet (prise avant envoi)', async () => {
    config();
    await waOrder();
    expect(sheetsCalls[0].sheetsSentAtCall).toBe(true);
  });

  it('TIMEOUT : aucun délai maximal — l’appel au Sheet ne reçoit pas de signal d’annulation', async () => {
    config();
    await waOrder();
    expect(sheetsCalls[0].signal).toBeUndefined();
  });

  it('PAS DE REPRISE : après un échec, une nouvelle commande complète ne rappelle pas le Sheet', async () => {
    config();
    sheetsOutcome = 500;
    await waOrder();
    sheetsOutcome = 200;
    await wa('Amine B, 0550123456, wahran', COMPLETE);
    expect(sheetsCalls).toHaveLength(1);
    expect(session()?.sheets_sent).toBe(true);
  });

  it('SANS Sheet configuré (et sans admin) : sheets_sent passe quand même à true', async () => {
    config({ google_sheets_url: '' });
    await waOrder();
    expect(sheetsCalls).toHaveLength(0);
    expect(session()?.is_complete).toBe(true);
    expect(session()?.sheets_sent).toBe(true);
  });

  it('prise locale en ÉCHEC (update refusé) : le Sheet n’est PAS appelé, sheets_sent reste false', async () => {
    config();
    await wa('nheb montre', 'Wach smitek ?');
    const from = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation((t: string) => {
      const b = from(t) as unknown as { update: (p: Record<string, unknown>) => unknown };
      if (t === 'ai_chat_sessions') {
        const update = b.update.bind(b);
        b.update = (p) => {
          if (p.sheets_sent === true) db.failNext('public', 'ai_chat_sessions', 'update');
          return update(p);
        };
      }
      return b as never;
    });
    await wa('Amine B, 0550123456, wahran', COMPLETE);
    expect(sheetsCalls).toHaveLength(0);
    expect(session()?.sheets_sent).toBe(false);
  });
});

describe('Messenger — sheets_sent', () => {
  it('Sheet → 500 : sheets_sent = true, journal failed', async () => {
    config();
    sheetsOutcome = 500;
    await fb('Montre', COMPLETE);
    expect(session('facebook')?.sheets_sent).toBe(true);
    expect(sheetsFailures()).toHaveLength(1);
  });

  it('DIVERGENCE : SANS Sheet configuré, sheets_sent reste false (WhatsApp : true)', async () => {
    config({ google_sheets_url: '' });
    await fb('Montre', COMPLETE);
    expect(session('facebook')?.is_complete).toBe(true);
    expect(session('facebook')?.sheets_sent).toBe(false);
  });
});
