// Webhook WhatsApp du chatbot — scénarios bout en bout (Supabase en mémoire,
// Gemini / Evolution / Google Sheets simulés).

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
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'global-key' }),
}));

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT = '213550000001@s.whatsapp.net';
const SHEETS = 'https://sheets.test/hook';

let geminiReply = '';
const sheetsCalls: Array<Record<string, unknown>> = [];
const waSends: Array<{ number: string; text: string }> = [];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  await new Promise((r) => setTimeout(r, 5)); // latence réseau → fenêtre de concurrence
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    return Response.json({
      candidates: [{ content: { parts: [{ text: geminiReply }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
    });
  }
  if (url === SHEETS) {
    sheetsCalls.push(JSON.parse(String(init?.body)));
    return new Response('ok');
  }
  if (url.startsWith('https://evolution.test/message/sendText/')) {
    waSends.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  }
  return new Response('{}');
});

let msgSeq = 0;
function inbound(text: string) {
  msgSeq++;
  return new NextRequest('https://app.test/api/ai-chatbot/webhook/whatsapp', {
    method: 'POST',
    body: JSON.stringify({
      event: 'messages.upsert',
      instance: 'zrex_test_auto',
      data: {
        key: { remoteJid: CONTACT, fromMe: false, id: `MSG-${Date.now()}-${msgSeq}` },
        message: { conversation: text },
        pushName: 'Client',
      },
    }),
  });
}

const COMPLETE =
  'Yallah mliha! Sajjelna commande ta3ek ✅ <data>{"nom":"Amine B","telephone":"0550123456","wilaya":"wahran","produit":"Montre"}</data>';

beforeEach(() => {
  db = new FakeSupabase();
  sheetsCalls.length = 0;
  waSends.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  db.seed('public', 'whatsapp_instances', [
    { user_id: TENANT, service_type: 'auto_confirmation', instance_name: 'zrex_test_auto' },
  ]);
  db.seed('public', 'chatbot_configs', [
    {
      user_id: TENANT,
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
  db.seed('public', 'ai_chat_sessions', [
    {
      user_id: TENANT,
      channel: 'whatsapp',
      contact_id: CONTACT,
      conversation: [{ role: 'assistant', content: 'Chhal men wa7da tebghi ?' }],
      extracted_data: {},
      sheets_sent: false,
    },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function post(text: string) {
  const { POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route');
  return POST(inbound(text));
}

describe('commande complète — Google Sheets', () => {
  it('deux messages traités en parallèle → UNE seule ligne dans le Sheet', async () => {
    geminiReply = COMPLETE;
    await Promise.all([post('Montre noire svp'), post('Ana f Oran')]);
    expect(sheetsCalls).toHaveLength(1);
    expect(db.all('public', 'ai_chat_sessions')[0].sheets_sent).toBe(true);
  });

  it('les données envoyées sont validées et normalisées', async () => {
    geminiReply = COMPLETE;
    await post('Montre noire svp');
    expect(sheetsCalls[0]).toMatchObject({
      nom: 'Amine B',
      telephone: '0550123456',
      wilaya: 'Oran',
      produit: 'Montre',
    });
  });

  it('un Sheet déjà servi n’est jamais re-servi', async () => {
    geminiReply = COMPLETE;
    await post('Montre noire svp');
    await post('Merci bezzaf khouya');
    expect(sheetsCalls).toHaveLength(1);
  });

  it('valeur commençant par « = » neutralisée avant le Sheet', async () => {
    geminiReply =
      'OK ✅ <data>{"nom":"=IMPORTXML(\\"http://x\\",\\"//a\\")","telephone":"0550123456","wilaya":"Oran","produit":"Montre"}</data>';
    await post('Montre noire svp');
    expect(String(sheetsCalls[0].nom).startsWith("'=")).toBe(true);
  });
});

describe('sortie du modèle refusée', () => {
  it('téléphone invalide → rien dans le Sheet, le client est invité à corriger', async () => {
    geminiReply =
      'Sajjelna commande ✅ <data>{"nom":"A","telephone":"12","wilaya":"Oran","produit":"B"}</data>';
    await post('Montre noire svp');
    expect(sheetsCalls).toHaveLength(0);
    const last = waSends[waSends.length - 1];
    expect(last.text).toMatch(/05, 06 wella 07/);
    expect(last.text).not.toMatch(/Sajjelna/);
    expect(db.all('public', 'ai_chat_sessions')[0].extracted_data.telephone).toBeUndefined();
  });
});

describe('réponses courtes en cours de conversation', () => {
  it('« 2 » (quantité) va au modèle au lieu du message d’accueil', async () => {
    geminiReply = 'Mliha, 2 montres. Wach isemek ?';
    await post('2');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('generativelanguage'))).toBe(true);
    expect(waSends[waSends.length - 1].text).toBe('Mliha, 2 montres. Wach isemek ?');
  });
});
