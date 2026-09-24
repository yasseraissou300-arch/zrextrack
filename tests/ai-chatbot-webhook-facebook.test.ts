// Webhook Messenger — même validation que WhatsApp, une ligne Sheets par
// commande, et dédoublonnage des relivraisons Meta (message.mid).

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

let geminiReply = '';
let geminiCalls = 0;
const sheetsCalls: Array<Record<string, unknown>> = [];
const fbReplies: string[] = [];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  await new Promise((r) => setTimeout(r, 5));
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    geminiCalls++;
    return Response.json({ candidates: [{ content: { parts: [{ text: geminiReply }] } }] });
  }
  if (url === SHEETS) {
    sheetsCalls.push(JSON.parse(String(init?.body)));
    return new Response('ok');
  }
  if (url.startsWith('https://graph.facebook.com/')) {
    fbReplies.push(JSON.parse(String(init?.body)).message.text);
    return new Response('{}');
  }
  return new Response('{}');
});

let seq = 0;
function event(text: string, mid = `m-${++seq}`) {
  return new NextRequest('https://app.test/api/ai-chatbot/webhook/facebook', {
    method: 'POST',
    body: JSON.stringify({
      object: 'page',
      entry: [{ id: PAGE, messaging: [{ sender: { id: SENDER }, message: { mid, text } }] }],
    }),
  });
}

async function post(req: NextRequest) {
  const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
  return POST(req);
}

const COMPLETE =
  'Mliha ✅ <data>{"nom":"Amine B","telephone":"0550123456","wilaya":"wahran","produit":"Montre"}</data>';

beforeEach(() => {
  db = new FakeSupabase();
  geminiCalls = 0;
  sheetsCalls.length = 0;
  fbReplies.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FACEBOOK_APP_SECRET', ''); // signature non appliquée (testée ailleurs)
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
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

describe('Messenger — commande complète', () => {
  it('deux messages en parallèle → une seule ligne dans le Sheet', async () => {
    geminiReply = COMPLETE;
    await Promise.all([post(event('Montre noire')), post(event('Ana f Oran'))]);
    expect(sheetsCalls).toHaveLength(1);
  });

  it('données normalisées avant le Sheet', async () => {
    geminiReply = COMPLETE;
    await post(event('Montre noire'));
    expect(sheetsCalls[0]).toMatchObject({ telephone: '0550123456', wilaya: 'Oran' });
  });

  it('téléphone invalide → pas de Sheet, demande de correction', async () => {
    geminiReply =
      'Mliha ✅ <data>{"nom":"A","telephone":"12","wilaya":"Oran","produit":"B"}</data>';
    await post(event('Montre noire'));
    expect(sheetsCalls).toHaveLength(0);
    expect(fbReplies[0]).toMatch(/05, 06 wella 07/);
  });
});

describe('Messenger — relivraison Meta', () => {
  it('le même message (mid) relivré n’appelle l’IA qu’une fois', async () => {
    geminiReply = 'Salam, wach tebghi ?';
    await post(event('Salam', 'mid-dup'));
    await post(event('Salam', 'mid-dup'));
    expect(geminiCalls).toBe(1);
    expect(fbReplies).toHaveLength(1);
  });
});
