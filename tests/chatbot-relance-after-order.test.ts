// P3 — Relance « commande non terminée » envoyée à un client qui a DÉJÀ commandé.
//
// Chaîne réelle, bout en bout, entièrement simulée (base en mémoire, Gemini,
// Evolution et Google Sheets factices ; aucun envoi réel) :
//   webhook WhatsApp → session → extraction → is_complete → Sheets / sheets_sent
//   → inactivité → runRelance.
//
// INVARIANT : un client dont la commande a été finalisée (sheets_sent = true)
// n'est jamais rendu éligible à la relance des commandes incomplètes parce
// qu'il envoie un nouveau message.

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
const COMPLETE_2 =
  'Sajjelna commande ✅ <data>{"nom":"Amine B","telephone":"0550123456","wilaya":"wahran","produit":"Sac"}</data>';

let geminiReply = '';
let sheetsFails = false;
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
    return new Response('ok');
  }
  if (url.startsWith('https://evolution.test/message/sendText/')) {
    waSends.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  }
  return new Response('{}');
});

let POST: (req: NextRequest) => Promise<Response>;
let runRelance: typeof import('@/lib/ai-chatbot/relance').runRelance;
let RELANCE_MESSAGES: Record<string, string>;
beforeAll(async () => {
  ({ POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route'));
  ({ runRelance, RELANCE_MESSAGES } = await import('@/lib/ai-chatbot/relance'));
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
/** Le client se tait : dernière activité il y a 3 h (seuil de relance : 2 h). */
function goIdle() {
  session().updated_at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
}
/** Relances « commande non terminée » effectivement envoyées au client. */
const relanceSends = () =>
  waSends.filter(
    (s) => s.text === RELANCE_MESSAGES.auto_confirmation && s.number === '213550000001'
  );

async function relance() {
  waSends.length = 0;
  return runRelance(db as never, T);
}

beforeEach(() => {
  db = new FakeSupabase();
  geminiReply = '';
  sheetsFails = false;
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

async function completeOrder() {
  await inbound('nheb montre', 'Wach smitek ?');
  await inbound('Amine B, 0550123456, wahran', COMPLETE);
  expect(session()).toMatchObject({ is_complete: true, sheets_sent: true });
  expect(sheetsCalls).toHaveLength(1);
}

// ─── Scénario A — commande finalisée puis « Merci » ─────────────────────────

describe('A — commande finalisée, puis un nouveau message', () => {
  it('diagnostic : « Merci » fait repasser is_complete à false (comportement de session conservé)', async () => {
    await completeOrder();
    await inbound('Merci', 'Bla jmil, sahha 🙏');
    expect(session().is_complete).toBe(false);
    expect(session().sheets_sent).toBe(true); // la commande, elle, est bien finalisée
  });

  it('« Merci » puis 3 h de silence : AUCUNE relance « commande non terminée »', async () => {
    await completeOrder();
    await inbound('Merci', 'Bla jmil 🙏');
    goIdle();
    const r = await relance();
    expect(r.relanced).toBe(0);
    expect(relanceSends()).toHaveLength(0);
  });

  it('message sans rapport après la commande : aucune relance non plus', async () => {
    await completeOrder();
    await inbound('3andkom des sacs ?', 'Ih 3andna, tebghi tchouf ?');
    goIdle();
    expect((await relance()).relanced).toBe(0);
  });

  it('simulation (dry_run) : la session n’est même pas comptée comme éligible', async () => {
    await completeOrder();
    await inbound('Merci', 'Bla jmil');
    goIdle();
    const r = await runRelance(db as never, T, { dryRun: true });
    expect(r.eligible).toBe(0);
  });
});

// ─── Scénario B — commande jamais finalisée ─────────────────────────────────

describe('B — commande NON finalisée : la relance reste autorisée', () => {
  it('commande abandonnée après le premier échange : relancée une fois', async () => {
    await inbound('nheb montre', 'Wach smitek ?');
    goIdle();
    const r = await relance();
    expect(r.relanced).toBe(1);
    expect(relanceSends()).toHaveLength(1);
    expect(session().relance_sent).toBe(true);
  });

  it('commande partiellement remplie (données refusées) : relancée', async () => {
    await inbound('nheb montre', 'Wach smitek ?');
    await inbound('Amine, 12', 'ok <data>{"nom":"Amine B","telephone":"12"}</data>');
    expect(session().sheets_sent ?? false).toBe(false);
    goIdle();
    expect((await relance()).relanced).toBe(1);
  });

  it('client sans historique (nouvelle session incomplète) : relancé', async () => {
    await inbound('salam, chhal soumha l montre ?', 'Salam! 2500 DA.');
    goIdle();
    expect((await relance()).relanced).toBe(1);
  });

  it('jamais relancé deux fois (relance_sent, comportement existant)', async () => {
    await inbound('nheb montre', 'Wach smitek ?');
    goIdle();
    await relance();
    goIdle();
    expect((await relance()).relanced).toBe(0);
  });
});

// ─── Cas limites de la finalisation ─────────────────────────────────────────

describe('finalisation — cas limites', () => {
  it('Google Sheets injoignable : la commande est prise en charge (sheets_sent) → pas de relance', async () => {
    sheetsFails = true;
    await inbound('nheb montre', 'Wach smitek ?');
    await inbound('Amine B, 0550123456, wahran', COMPLETE);
    // Constat : l'échec Sheets est avalé, sheets_sent reste true, aucune reprise (voir BACKLOG).
    expect(session().sheets_sent).toBe(true);
    await inbound('Merci', 'Bla jmil');
    goIdle();
    expect((await relance()).relanced).toBe(0);
  });

  it('écriture de la session en échec : commande NON prise en charge → relance autorisée', async () => {
    await inbound('nheb montre', 'Wach smitek ?');
    db.failNext('public', 'ai_chat_sessions', 'update', { code: '08006' });
    await inbound('Amine B, 0550123456, wahran', COMPLETE);
    expect(sheetsCalls).toHaveLength(0); // ni Sheets ni admin si l'écriture a échoué
    expect(session().sheets_sent ?? false).toBe(false);
    goIdle();
    expect((await relance()).relanced).toBe(1);
  });

  it('rejeu du message qui finalise (retry / double webhook) : un seul Sheet, aucune relance', async () => {
    await inbound('nheb montre', 'Wach smitek ?');
    await inbound('Amine B, 0550123456, wahran', COMPLETE, 'EVT-FINAL');
    await inbound('Amine B, 0550123456, wahran', COMPLETE, 'EVT-FINAL');
    expect(sheetsCalls).toHaveLength(1);
    await inbound('Merci', 'Bla jmil');
    goIdle();
    expect((await relance()).relanced).toBe(0);
  });

  it('deux messages rapides après la commande : aucune relance', async () => {
    await completeOrder();
    await Promise.all([inbound('Merci', 'Bla jmil'), inbound('Sahha', 'Sahha lik')]);
    goIdle();
    expect((await relance()).relanced).toBe(0);
  });

  it('commande finalisée ENTRE le balayage et la prise : pas de relance (prise conditionnelle)', async () => {
    await inbound('nheb montre', 'Wach smitek ?');
    goIdle();
    // La commande est finalisée pendant que la relance vérifie quota et instance.
    const racing = {
      from: (t: string) => {
        const b = db.from(t) as unknown as { update: (p: Record<string, unknown>) => unknown };
        if (t === 'ai_chat_sessions') {
          const orig = b.update.bind(b);
          b.update = (p) => {
            if ('relance_sent' in p)
              Object.assign(session(), { sheets_sent: true, is_complete: true });
            return orig(p);
          };
        }
        return b;
      },
    };
    waSends.length = 0;
    const r = await runRelance(racing as never, T);
    expect(r.relanced).toBe(0);
    expect(relanceSends()).toHaveLength(0);
  });
});

// ─── Plusieurs commandes dans la même session ───────────────────────────────

describe('client avec plusieurs commandes (même contact = même session)', () => {
  it('LIMITE CONNUE : la 2e commande complète n’atteint pas le Sheet (sheets_sent déjà pris) — inchangé ici', async () => {
    await completeOrder();
    await inbound('nheb zada sac', 'Mliha, nfs l3onwan ?');
    await inbound('ih', COMPLETE_2);
    // Documente le comportement ACTUEL : une session = une seule commande
    // transmise. Correction = frontière de commande (migration), voir rapport.
    expect(sheetsCalls).toHaveLength(1);
    expect(session().extracted_data.produit).toBe('Sac');
  });

  it('nouvelle commande commencée après une commande finalisée : pas de relance « non terminée »', async () => {
    await completeOrder();
    await inbound('nheb zada sac', 'Mliha, wach smitek ?');
    goIdle();
    expect((await relance()).relanced).toBe(0);
  });
});
