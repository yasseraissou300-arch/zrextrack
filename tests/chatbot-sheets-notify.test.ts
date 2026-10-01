// P4 — Échec de l'envoi Google Sheets d'une commande chatbot : plus jamais SILENCIEUX.
//
// CONSTAT (code) : notifyGoogleSheets avalait toute exception et ne regardait
// pas le statut HTTP ; sheets_sent était déjà pris → commande « transmise »
// sans ligne dans le Sheet, et AUCUNE trace dans les journaux.
//
// Périmètre de la correction : un journal sûr (tenant, statut HTTP ou code
// d'erreur — jamais l'URL du Sheet, ni téléphone, ni nom, ni contenu). La
// reprise automatique (sheets_sent remis à false, job de rattrapage) reste une
// DÉCISION (BACKLOG, catégorie D) : sheets_sent n'est pas modifié ici.
//
// Harnais repris de tests/chatbot-relance-after-order.test.ts : webhook WhatsApp
// réel, base en mémoire, Gemini / Evolution / Sheets factices, aucun envoi réel.

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
const SHEETS = 'https://sheets.test/hook';
const COMPLETE =
  'Sajjelna commande ✅ <data>{"nom":"Amine B","telephone":"0550123456","wilaya":"wahran","produit":"Montre"}</data>';

let geminiReply = '';
let sheetsFails = false;
let sheetsStatus = 200;
const sheetsCalls: unknown[] = [];
const waSends: Array<{ number: string; text: string }> = [];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    return Response.json({
      candidates: [{ content: { parts: [{ text: geminiReply }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
  }
  if (url === SHEETS) {
    if (sheetsFails) throw new TypeError('fetch failed');
    sheetsCalls.push(JSON.parse(String(init?.body)));
    return new Response(sheetsStatus === 200 ? 'ok' : 'Script error', { status: sheetsStatus });
  }
  if (url.startsWith('https://evolution.test/message/sendText/')) {
    waSends.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  }
  return new Response('{}');
});

let POST: (req: NextRequest) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route'));
});

let seq = 0;
async function inbound(text: string, reply: string, id = `R-${++seq}`) {
  geminiReply = reply;
  return POST(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'zrex_t_auto',
        data: {
          key: { remoteJid: C, fromMe: false, id },
          message: { conversation: text },
          pushName: 'Client',
        },
      }),
    })
  );
}

const session = () => db.all('public', 'ai_chat_sessions')[0];


beforeEach(() => {
  db = new FakeSupabase();
  geminiReply = '';
  sheetsFails = false;
  sheetsStatus = 200;
  sheetsCalls.length = 0;
  waSends.length = 0;
  vi.stubGlobal('fetch', fetchMock);
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
    },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});


/** Lignes de journal (toutes méthodes console) émises pendant le test. */
function logLines(): string[] {
  return (['log', 'info', 'warn', 'error'] as const).flatMap((m) =>
    (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
  );
}
const sheetsFailures = () =>
  logLines()
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.scope === 'chatbot.sheets' && l.status === 'failed');

async function order() {
  await inbound('nheb montre', 'Wach smitek ?');
  await inbound('Amine B, 0550123456, wahran', COMPLETE);
}

describe('Google Sheets — échec de transmission journalisé', () => {
  it('panne réseau (exception) → journal warn chatbot.sheets failed + code d’erreur', async () => {
    sheetsFails = true;
    await order();
    const f = sheetsFailures();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: 'warn', tenant_id: T, status: 'failed' });
    expect(typeof f[0].error_code).toBe('string');
  });

  it('réponse HTTP 500 du Sheet → journal avec http_status 500', async () => {
    sheetsStatus = 500;
    await order();
    const f = sheetsFailures();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ tenant_id: T, status: 'failed', http_status: 500 });
  });

  it('succès → aucun journal d’échec', async () => {
    await order();
    expect(sheetsCalls).toHaveLength(1);
    expect(sheetsFailures()).toHaveLength(0);
  });

  it('le journal ne contient ni l’URL du Sheet, ni téléphone, ni nom, ni contenu', async () => {
    sheetsStatus = 403;
    await order();
    const all = logLines().join('\n');
    expect(sheetsFailures()).toHaveLength(1);
    expect(all).not.toContain(SHEETS);
    expect(all).not.toContain('sheets.test');
    expect(all).not.toContain('0550123456');
    expect(all).not.toContain('Amine');
    expect(all).not.toContain('Script error');
  });

  it('comportement conservé : sheets_sent pris, le client reçoit quand même sa réponse', async () => {
    sheetsFails = true;
    await order();
    expect(session().sheets_sent).toBe(true);
    expect(waSends.some((s) => s.number === '213550000001')).toBe(true);
  });
});
