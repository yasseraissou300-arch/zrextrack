// P4 — Couverture du plafond anti-spam WhatsApp (40 / 24 h) : CONSTAT, aucun code modifié.
//
// Le plafond est calculé (file, drain, envoi manuel, relance) par :
//   count(public.messages) WHERE user_id = <tenant> AND status = 'envoye'
//                           AND sent_at >= now() - 24 h
// Ce fichier fait tourner les VRAIS chemins d'envoi (base en mémoire, Evolution,
// Gemini et Graph simulés par fetch, aucun réseau) et mesure, pour chacun :
// appel Evolution ? ligne messages ? statut ? quota consommé ? quota vérifié ?
// Voir .claude/mission/whatsapp-quota-audit.md.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import type { Job } from '@/lib/queue/types';

let db: FakeSupabase;
let currentUser = '';
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser ? { id: currentUser } : null } }) },
    from: (t: string) => db.from(t),
  }),
}));
vi.mock('@/lib/user-creds', () => ({
  resolveGeminiKeys: async () => ['gemini-test-key'],
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'global-key' }),
}));
vi.mock('@/lib/whatsapp/anti-spam', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/anti-spam')>();
  return { ...actual, sleep: async () => {}, randomThrottle: () => 0 }; // aucune attente réelle
});

import { handleWhatsAppSend } from '@/lib/queue/handlers/whatsapp-send';
import { drainNotifications } from '@/lib/whatsapp/drain-notifications';
import { runRelance } from '@/lib/ai-chatbot/relance';
import { ANTI_SPAM } from '@/lib/whatsapp/anti-spam';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CLIENT = '213550000001';
const ADMIN = '213660000009';
const COMPLETE =
  'Sajjelna commande ✅ <data>{"nom":"Amine B","telephone":"0550000001","wilaya":"wahran","produit":"Montre"}</data>';

let evoStatus = 200;
let evoDelayMs = 0;
let geminiReply = 'Wach smitek ?';
const evo: Array<{ instance: string; number: string }> = [];
const graph: unknown[] = [];

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('/instance/connectionState/')) return Response.json({ state: 'open' });
  if (url.startsWith('https://evolution.test/message/')) {
    if (evoDelayMs) await new Promise((r) => setTimeout(r, evoDelayMs));
    evo.push({
      instance: url.split('/').pop() ?? '',
      number: String(JSON.parse(String(init?.body)).number),
    });
    return new Response(evoStatus < 300 ? '{}' : 'error', { status: evoStatus });
  }
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    return Response.json({
      candidates: [{ content: { parts: [{ text: geminiReply }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
  }
  if (url.startsWith('https://graph.facebook.com/')) {
    graph.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  }
  return new Response('{}');
});

// ─── Mesures ────────────────────────────────────────────────────────────────

/** Exactement la requête de quota : lignes 'envoye' du tenant sur 24 h glissantes. */
function quotaUsed(tenant = A): number {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return db
    .all('public', 'messages')
    .filter(
      (m) => m.user_id === tenant && m.status === 'envoye' && Date.parse(m.sent_at) >= since
    ).length;
}
const rows = (tenant = A) => db.all('public', 'messages').filter((m) => m.user_id === tenant);

/** N envois réussis déjà consommés, il y a 1 h (hors fenêtre d'espacement). */
function consumed(n: number, tenant = A) {
  const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  db.seed(
    'public',
    'messages',
    Array.from({ length: n }, (_, i) => ({
      id: `${tenant.slice(0, 4)}-q${i}`,
      user_id: tenant,
      tracking_number: `OLD-${i}`,
      customer_name: '',
      customer_whatsapp: `21355000${String(i).padStart(4, '0')}`,
      message: 'ancien',
      status: 'envoye',
      sent_at: at,
    }))
  );
}

// ─── Chemins d'envoi ────────────────────────────────────────────────────────

let jobSeq = 0;
function job(tenant = A, over: Record<string, unknown> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: `job-${++jobSeq}`,
    tenant_id: tenant,
    type: 'whatsapp.send',
    payload: { phone: '0550000001', message: 'Colis en route', tracking_number: 'ZR-1', ...over },
    status: 'running',
    run_after: now,
    attempts: 1,
    max_attempts: 1,
    locked_at: now,
    locked_by: 'w',
    last_error: null,
    idempotency_key: null,
    created_at: now,
    updated_at: now,
  } as Job;
}

function pendingNotif(tenant = A, id = 'n1') {
  db.seed('public', 'pending_notifications', [
    {
      id,
      user_id: tenant,
      tracking_number: 'ZR-9',
      delivery_status: 'en_livraison',
      customer_name: 'Client',
      customer_whatsapp: '0550000001',
      wilaya: 'Oran',
      product_name: 'Produit',
      cod: 2500,
      status: 'pending',
      created_at: new Date().toISOString(),
    },
  ]);
}
const drain = (tenant = A) => drainNotifications(db as never, tenant, new Map());

async function manualSend(tenant = A) {
  currentUser = tenant;
  const { POST } = await import('@/app/api/whatsapp/send/route');
  return POST(
    new NextRequest('https://app.test/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({
        recipients: [{ tracking: 'ZR-5', client: 'Client', whatsapp: '0550000001', message: 'Salam' }],
      }),
    })
  );
}

let seq = 0;
async function chatbot(text: string, reply: string) {
  geminiReply = reply;
  const { POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route');
  return POST(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'zrex_a_auto',
        data: {
          key: { remoteJid: `${CLIENT}@s.whatsapp.net`, fromMe: false, id: `W-${++seq}` },
          message: { conversation: text },
          pushName: 'Client',
        },
      }),
    })
  );
}

async function messenger(text: string) {
  geminiReply = 'Salam, wach tebghi ?';
  const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
  return POST(
    new NextRequest('https://app.test/api/ai-chatbot/webhook/facebook', {
      method: 'POST',
      body: JSON.stringify({
        object: 'page',
        entry: [
          { id: 'page-1', messaging: [{ sender: { id: 'psid-1' }, message: { mid: `m-${++seq}`, text } }] },
        ],
      }),
    })
  );
}

const SAV_ID = '33333333-3333-4333-8333-333333333333';
async function resolveSav(tenant = A) {
  db.seed('public', 'ai_chat_sessions', [
    {
      id: SAV_ID,
      user_id: tenant,
      channel: 'whatsapp',
      contact_id: `${CLIENT}@s.whatsapp.net`,
      contact_name: 'Client',
      template_type: 'sav',
      conversation: [],
      extracted_data: {},
      is_complete: true,
      sheets_sent: true,
      human_handover: false,
      relance_sent: false,
      resolution: null,
      updated_at: new Date().toISOString(),
    },
  ]);
  currentUser = tenant;
  const { POST } = await import('@/app/api/ai-chatbot/reclamations/resolve/route');
  return POST(
    new NextRequest('https://app.test/api/ai-chatbot/reclamations/resolve', {
      method: 'POST',
      body: JSON.stringify({ sessionId: SAV_ID, resolution: 'refund' }),
    })
  );
}

function staleSession(tenant = A) {
  db.seed('public', 'ai_chat_sessions', [
    {
      id: '44444444-4444-4444-8444-444444444444',
      user_id: tenant,
      channel: 'whatsapp',
      contact_id: `${CLIENT}@s.whatsapp.net`,
      template_type: 'auto_confirmation',
      conversation: [],
      extracted_data: {},
      is_complete: false,
      sheets_sent: false,
      human_handover: false,
      relance_sent: false,
      resolution: null,
      updated_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
  ]);
}

function seedTenant(tenant: string, tag: string) {
  db.seed('public', 'profiles', [{ id: tenant, whatsapp_warmup_started_at: null }]);
  db.seed('public', 'whatsapp_instances', [
    { user_id: tenant, service_type: 'auto_confirmation', instance_name: `zrex_${tag}_auto`, connected: true },
    { user_id: tenant, service_type: 'sav', instance_name: `zrex_${tag}_sav`, connected: true },
  ]);
  db.seed('public', 'chatbot_configs', [
    {
      user_id: tenant,
      template_type: 'auto_confirmation',
      is_active: true,
      google_sheets_url: '',
      admin_whatsapp: ADMIN,
      shop_name: 'Boutique',
      custom_prompt: null,
      media_url: null,
      blocked_prefixes: [],
    },
  ]);
}

beforeEach(() => {
  db = new FakeSupabase();
  evoStatus = 200;
  evoDelayMs = 0;
  evo.length = 0;
  graph.length = 0;
  currentUser = '';
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FACEBOOK_APP_SECRET', '');
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  seedTenant(A, 'a');
  seedTenant(B, 'b');
  db.seed('public', 'facebook_connections', [{ user_id: A, page_id: 'page-1', page_access_token: 'tok' }]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── 1. Chaque chemin : envoi, journal, quota ───────────────────────────────

describe('cartographie — chaque envoi sortant face au quota', () => {
  it('1 notification (drain) réussie → Evolution 1, ligne envoye, quota +1', async () => {
    pendingNotif();
    expect(await drain()).toBe(1);
    expect(evo).toHaveLength(1);
    expect(rows().map((r) => r.status)).toEqual(['envoye']);
    expect(quotaUsed()).toBe(1);
  });

  it('2 notification (drain) échouée → Evolution 1, ligne echec, quota +0', async () => {
    pendingNotif();
    evoStatus = 500;
    await drain();
    expect(evo).toHaveLength(1);
    expect(rows().map((r) => r.status)).toEqual(['echec']);
    expect(quotaUsed()).toBe(0);
  });

  it('3 réponse chatbot WhatsApp → Evolution 1, AUCUNE ligne, quota +0', async () => {
    await chatbot('nheb montre', 'Wach smitek ?');
    expect(evo.filter((e) => e.number === CLIENT)).toHaveLength(1);
    expect(rows()).toHaveLength(0);
    expect(quotaUsed()).toBe(0);
  });

  it('4 résolution SAV → Evolution 1 (instance sav), AUCUNE ligne, quota +0', async () => {
    const res = await resolveSav();
    expect((await res.json()).whatsapp).toBe('sent');
    expect(evo).toEqual([{ instance: 'zrex_a_sav', number: CLIENT }]);
    expect(rows()).toHaveLength(0);
    expect(quotaUsed()).toBe(0);
  });

  it('5 alerte admin (commande complète) → Evolution vers l’admin, AUCUNE ligne, quota +0', async () => {
    await chatbot('nheb montre', 'Wach smitek ?');
    await chatbot('Amine B, 0550000001, wahran', COMPLETE);
    expect(evo.filter((e) => e.number === ADMIN)).toHaveLength(1);
    expect(rows()).toHaveLength(0);
    expect(quotaUsed()).toBe(0);
  });

  it('6 relance → Evolution 1, ligne envoye, quota +1', async () => {
    staleSession();
    expect((await runRelance(db as never, A)).relanced).toBe(1);
    expect(evo).toHaveLength(1);
    expect(rows().map((r) => r.status)).toEqual(['envoye']);
    expect(quotaUsed()).toBe(1);
  });

  it('7 campagne (file whatsapp.send) → Evolution 1, ligne envoye, quota +1', async () => {
    expect(await handleWhatsAppSend(job(A, { campaign_id: 'camp-1' }))).toEqual({ outcome: 'done' });
    expect(evo).toHaveLength(1);
    expect(rows().map((r) => r.status)).toEqual(['envoye']);
    expect(quotaUsed()).toBe(1);
  });

  it('8 file : échec (aucune ligne) puis nouvel essai réussi → 2 appels Evolution, quota +1', async () => {
    evoStatus = 500;
    await handleWhatsAppSend(job());
    expect(rows()).toHaveLength(0);
    evoStatus = 200;
    await handleWhatsAppSend(job());
    expect(evo).toHaveLength(2);
    expect(quotaUsed()).toBe(1);
  });

  it('9 envoi manuel / « Renvoyer » → ligne envoye, quota +1 ; échec → ligne echec, quota +0', async () => {
    expect((await manualSend()).status).toBe(200);
    expect(quotaUsed()).toBe(1);
    evoStatus = 500;
    await manualSend();
    expect(rows().map((r) => r.status).sort()).toEqual(['echec', 'envoye']);
    expect(quotaUsed()).toBe(1);
  });

  it('10 même numéro, deux flows en 24 h (notification + résolution SAV) → 2 envois, quota +1', async () => {
    pendingNotif();
    await drain();
    await resolveSav();
    expect(evo.filter((e) => e.number === CLIENT)).toHaveLength(2);
    expect(quotaUsed()).toBe(1);
  });

  it('Messenger → appel Graph, AUCUN appel Evolution, aucune ligne (hors quota WhatsApp, correct)', async () => {
    await messenger('Salam');
    expect(graph).toHaveLength(1);
    expect(evo).toHaveLength(0);
    expect(rows()).toHaveLength(0);
  });
});

// ─── 2. Plafond atteint : qui est bloqué, qui passe ─────────────────────────

describe(`plafond atteint (${ANTI_SPAM.DAILY_LIMIT} envoyés < 24 h)`, () => {
  beforeEach(() => consumed(ANTI_SPAM.DAILY_LIMIT));

  it('file whatsapp.send : reportée, aucun appel Evolution', async () => {
    expect((await handleWhatsAppSend(job())).outcome).toBe('reschedule');
    expect(evo).toHaveLength(0);
  });

  it('drain des notifications : 0 envoi', async () => {
    pendingNotif();
    expect(await drain()).toBe(0);
    expect(evo).toHaveLength(0);
  });

  it('envoi manuel : 429 DAILY_LIMIT_REACHED', async () => {
    const res = await manualSend();
    expect(res.status).toBe(429);
    expect(evo).toHaveLength(0);
  });

  it('relance : sautée (daily_limit)', async () => {
    staleSession();
    const r = await runRelance(db as never, A);
    expect(r.skipped.daily_limit).toBe(1);
    expect(evo).toHaveLength(0);
  });

  it('CONSTAT — résolution SAV : envoyée quand même (41e), quota inchangé', async () => {
    await resolveSav();
    expect(evo).toHaveLength(1);
    expect(quotaUsed()).toBe(ANTI_SPAM.DAILY_LIMIT);
  });

  it('CONSTAT — chatbot + alerte admin : envoyés quand même, quota inchangé', async () => {
    await chatbot('nheb montre', 'Wach smitek ?');
    await chatbot('Amine B, 0550000001, wahran', COMPLETE);
    expect(evo.filter((e) => e.number === CLIENT)).toHaveLength(2);
    expect(evo.filter((e) => e.number === ADMIN)).toHaveLength(1);
    expect(quotaUsed()).toBe(ANTI_SPAM.DAILY_LIMIT);
  });
});

describe('39 envoyés + 1 résolution SAV', () => {
  it('CONSTAT — la résolution ne consomme rien : la notification suivante part (41 envois sortants en 24 h)', async () => {
    consumed(ANTI_SPAM.DAILY_LIMIT - 1);
    await resolveSav();
    expect((await handleWhatsAppSend(job())).outcome).toBe('done');
    expect(evo).toHaveLength(2);
    expect(quotaUsed()).toBe(ANTI_SPAM.DAILY_LIMIT);
  });
});

// ─── 3. Granularité, isolation, concurrence ─────────────────────────────────

describe('granularité et isolation', () => {
  it('par TENANT : le plafond de B n’affecte pas A', async () => {
    consumed(ANTI_SPAM.DAILY_LIMIT, B);
    expect((await handleWhatsAppSend(job(A))).outcome).toBe('done');
    expect((await handleWhatsAppSend(job(B))).outcome).toBe('reschedule');
  });

  it('PAS par instance : la ligne messages ne porte aucune instance → les envois de la relance SAV (instance sav) consomment le quota de la file (instance auto_confirmation)', async () => {
    const savSession = {
      id: '55555555-5555-4555-8555-555555555555',
      user_id: A,
      channel: 'whatsapp',
      contact_id: `${CLIENT}@s.whatsapp.net`,
      template_type: 'sav',
      conversation: [],
      extracted_data: {},
      is_complete: false,
      sheets_sent: false,
      human_handover: false,
      relance_sent: false,
      resolution: null,
      updated_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    };
    db.seed('public', 'ai_chat_sessions', [savSession]);
    consumed(ANTI_SPAM.DAILY_LIMIT - 1);
    await runRelance(db as never, A);
    expect(evo).toEqual([{ instance: 'zrex_a_sav', number: CLIENT }]);
    expect(Object.keys(rows().at(-1) ?? {})).not.toContain('instance_name');
    expect((await handleWhatsAppSend(job())).outcome).toBe('reschedule');
  });
});

describe('concurrence autour du 40e envoi', () => {
  it('CONSTAT — limite SOUPLE : deux envois simultanés à 39 lisent tous deux 39 et partent tous deux (41)', async () => {
    consumed(ANTI_SPAM.DAILY_LIMIT - 1);
    evoDelayMs = 5;
    const [r1, r2] = await Promise.all([handleWhatsAppSend(job()), handleWhatsAppSend(job())]);
    expect([r1.outcome, r2.outcome]).toEqual(['done', 'done']);
    expect(evo).toHaveLength(2);
    expect(quotaUsed()).toBe(ANTI_SPAM.DAILY_LIMIT + 1);
  });
});
