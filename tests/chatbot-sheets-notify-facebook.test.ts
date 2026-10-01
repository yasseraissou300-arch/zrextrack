// P4 — Échec de l'envoi Google Sheets d'une commande Messenger : plus jamais SILENCIEUX.
//
// Même défaut que WhatsApp (tests/chatbot-sheets-notify.test.ts) : le webhook
// Facebook faisait `fetch(sheet).catch(() => {})` sans regarder le statut HTTP.
// Correction : même journal sûr chatbot.sheets status=failed (tenant + statut
// HTTP ou code d'erreur ; jamais l'URL ni les données). sheets_sent inchangé.
//
// Harnais repris de tests/ai-chatbot-webhook-facebook.test.ts.

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
const SENDER = 'psid-1';
const SHEETS = 'https://sheets.test/hook';
const COMPLETE =
  'Mliha ✅ <data>{"nom":"Amine B","telephone":"0550123456","wilaya":"wahran","produit":"Montre"}</data>';

let sheetsFails = false;
let sheetsStatus = 200;
const sheetsCalls: Array<Record<string, unknown>> = [];
const fbReplies: string[] = [];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    return Response.json({ candidates: [{ content: { parts: [{ text: COMPLETE }] } }] });
  }
  if (url === SHEETS) {
    if (sheetsFails) throw new TypeError('fetch failed');
    sheetsCalls.push(JSON.parse(String(init?.body)));
    return new Response(sheetsStatus === 200 ? 'ok' : 'Script error', { status: sheetsStatus });
  }
  if (url.startsWith('https://graph.facebook.com/')) {
    fbReplies.push(JSON.parse(String(init?.body)).message.text);
    return new Response('{}');
  }
  return new Response('{}');
});

let seq = 0;
async function order() {
  const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
  return POST(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/facebook', {
      method: 'POST',
      body: JSON.stringify({
        object: 'page',
        entry: [
          {
            id: PAGE,
            messaging: [{ sender: { id: SENDER }, message: { mid: `m-${++seq}`, text: 'Montre' } }],
          },
        ],
      }),
    })
  );
}

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

beforeEach(() => {
  db = new FakeSupabase();
  sheetsFails = false;
  sheetsStatus = 200;
  sheetsCalls.length = 0;
  fbReplies.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FACEBOOK_APP_SECRET', ''); // signature non appliquée (testée ailleurs)
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  db.seed('public', 'facebook_connections', [
    { user_id: TENANT, page_id: PAGE, page_access_token: 'tok' },
  ]);
  db.seed('public', 'chatbot_configs', [
    {
      user_id: TENANT,
      is_active: true,
      template_type: 'auto_confirmation',
      google_sheets_url: SHEETS,
      custom_prompt: null,
    },
  ]);
  db.seed('public', 'ai_chat_sessions', [
    { user_id: TENANT, channel: 'facebook', contact_id: SENDER, conversation: [] },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Messenger — Google Sheets, échec journalisé', () => {
  it('panne réseau → journal warn chatbot.sheets failed + code d’erreur', async () => {
    sheetsFails = true;
    await order();
    const f = sheetsFailures();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: 'warn', tenant_id: TENANT, status: 'failed' });
    expect(typeof f[0].error_code).toBe('string');
  });

  it('HTTP 500 → journal avec http_status 500', async () => {
    sheetsStatus = 500;
    await order();
    expect(sheetsFailures()).toEqual([
      expect.objectContaining({ tenant_id: TENANT, status: 'failed', http_status: 500 }),
    ]);
  });

  it('succès → aucun journal d’échec', async () => {
    await order();
    expect(sheetsCalls).toHaveLength(1);
    expect(sheetsFailures()).toHaveLength(0);
  });

  it('journal sans URL du Sheet, téléphone, nom ni contenu', async () => {
    sheetsStatus = 403;
    await order();
    const all = logLines().join('\n');
    expect(sheetsFailures()).toHaveLength(1);
    expect(all).not.toContain('sheets.test');
    expect(all).not.toContain('0550123456');
    expect(all).not.toContain('Amine');
    expect(all).not.toContain('Script error');
  });

  it('comportement conservé : sheets_sent pris, le client reçoit sa réponse', async () => {
    sheetsFails = true;
    await order();
    expect(db.all('public', 'ai_chat_sessions')[0].sheets_sent).toBe(true);
    expect(fbReplies).toHaveLength(1);
  });
});
