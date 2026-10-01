// P4 — Bornes de la conversation chatbot WhatsApp : CONSTAT (aucun code modifié).
//
// Décrit le comportement ACTUEL ; chaque test « constat » deviendra rouge le
// jour où une borne sera décidée (valeurs = décision produit, voir
// .claude/mission/chatbot-conversation-bounds.md).
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

let geminiReply = '';
const geminiBodies: string[] = [];
let sheetsFails = false;
const sheetsCalls: unknown[] = [];
const waSends: Array<{ number: string; text: string }> = [];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    geminiBodies.push(String(init?.body));
    return Response.json({
      candidates: [{ content: { parts: [{ text: geminiReply }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
  }
  if (url === SHEETS) {
    if (sheetsFails) throw new TypeError('fetch failed');
    sheetsCalls.push(JSON.parse(String(init?.body)));
    return new Response('ok');
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
  sheetsCalls.length = 0;
  waSends.length = 0;
  geminiBodies.length = 0;
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


import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

function srcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? srcFiles(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

describe('conversation chatbot — bornes ACTUELLES (constat)', () => {
  it('CONSTAT — historique stocké sans plafond : 30 messages → 60 entrées conservées', async () => {
    for (let i = 0; i < 30; i++) {
      await inbound(`nheb nsa9si 3la produit numero ${i}`, `Ih, produit ${i} kayen`);
    }
    expect(session().conversation).toHaveLength(60);
  });

  it('borne existante — Gemini ne reçoit que les 10 derniers messages', async () => {
    for (let i = 0; i < 12; i++) {
      await inbound(`question numero ${i} 3la livraison`, `jawab ${i}`);
    }
    const last = geminiBodies.at(-1) ?? '';
    expect(last).toContain('question numero 11');
    expect(last).not.toContain('question numero 0 ');
  });

  it('CONSTAT — message entrant sans limite de longueur : 20 000 caractères envoyés tels quels à Gemini et stockés', async () => {
    const long = 'nheb montre ' + 'x'.repeat(20_000);
    await inbound(long, 'Wach smitek ?');
    expect(geminiBodies.some((b) => b.includes('x'.repeat(20_000)))).toBe(true);
    expect(session().conversation[0].content).toHaveLength(long.length);
  });

  it('CONSTAT — human_pause_until est LU par le webhook mais jamais ÉCRIT dans src/ (fonction morte)', () => {
    const files = srcFiles(join(process.cwd(), 'src'));
    const readers = files.filter((f) => readFileSync(f, 'utf8').includes('human_pause_until'));
    const writers = readers.filter((f) =>
      /human_pause_until\s*:/.test(readFileSync(f, 'utf8'))
    );
    expect(readers.length).toBeGreaterThan(0);
    expect(writers).toEqual([]);
  });
});
