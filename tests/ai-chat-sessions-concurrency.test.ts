// P3 — Concurrence sur ai_chat_sessions (historique du chatbot).
//
// Entrelacements CONTRÔLÉS : chaque appel Gemini reste suspendu jusqu'à ce que
// le test le libère. Aucun délai réel, aucune base réelle, aucun réseau.
//
//   A lit H · B lit H · A et B appellent Gemini · le test libère B puis A (ou
//   l'inverse) · chacun écrit.
//
// Invariants vérifiés : aucun message perdu, isolation session / tenant,
// idempotence (même événement rejoué), ordre, handover jamais annulé par une
// écriture périmée, compteurs non écrasés.

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

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const C1 = '213550000001@s.whatsapp.net';
const C2 = '213550000002@s.whatsapp.net';

// ── Gemini contrôlable ───────────────────────────────────────────────────────
type Pending = {
  lastUser: string;
  resolve: (reply: string | null) => void;
};
let pending: Pending[] = [];
let autoReply: ((lastUser: string) => string | null) | null = null;
const waSends: Array<{ number: string; text: string }> = [];

function geminiResponse(text: string | null) {
  if (text === null) return new Response('{"error":"quota"}', { status: 500 });
  return Response.json({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });
}

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    const body = JSON.parse(String(init?.body));
    const last = body.contents[body.contents.length - 1].parts[0].text as string;
    if (autoReply) return geminiResponse(autoReply(last));
    return new Promise<Response>((resolve) => {
      pending.push({ lastUser: last, resolve: (r) => resolve(geminiResponse(r)) });
    });
  }
  if (url.startsWith('https://evolution.test/message/sendText/')) {
    waSends.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  }
  return new Response('{}');
});

/**
 * Barrière : attend que `cond` soit vrai. La condition porte sur l'ÉTAT (appels
 * Gemini suspendus, réponses envoyées), jamais sur une durée : l'ordre des
 * étapes est imposé par le test, pas par le réseau.
 */
async function until(cond: () => boolean, label: string) {
  for (let i = 0; i < 2000; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`barrière non atteinte : ${label}`);
}

function release(userText: string, reply: string | null) {
  const i = pending.findIndex((p) => p.lastUser === userText);
  if (i < 0) throw new Error(`aucun appel Gemini en attente pour « ${userText} »`);
  pending.splice(i, 1)[0].resolve(reply);
}

let seq = 0;
function inbound(text: string, opts: { contact?: string; instance?: string; id?: string } = {}) {
  seq++;
  return new NextRequest('https://app.test/api/ai-chatbot/webhook/whatsapp', {
    method: 'POST',
    body: JSON.stringify({
      event: 'messages.upsert',
      instance: opts.instance ?? 'zrex_t1_auto',
      data: {
        key: {
          remoteJid: opts.contact ?? C1,
          fromMe: false,
          id: opts.id ?? `CC-${seq}-${Math.random()}`,
        },
        message: { conversation: text },
        pushName: 'Client',
      },
    }),
  });
}

let POST: (req: NextRequest) => Promise<Response>;
beforeAll(async () => {
  // Chargé une fois : la compilation du module ne doit pas se mêler aux barrières.
  ({ POST } = await import('@/app/api/ai-chatbot/webhook/whatsapp/route'));
});

async function post(text: string, opts?: Parameters<typeof inbound>[1]) {
  return POST(inbound(text, opts));
}

const session = (tenant = T1, contact = C1) =>
  db
    .all('public', 'ai_chat_sessions')
    .find((s) => s.user_id === tenant && s.contact_id === contact);
const userTurns = (s: Record<string, any> | undefined) =>
  (s?.conversation ?? []).filter((m: any) => m.role === 'user').map((m: any) => m.content);

beforeEach(() => {
  db = new FakeSupabase();
  pending = [];
  autoReply = null;
  waSends.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.seed('public', 'whatsapp_instances', [
    { user_id: T1, service_type: 'auto_confirmation', instance_name: 'zrex_t1_auto' },
    { user_id: T2, service_type: 'auto_confirmation', instance_name: 'zrex_t2_auto' },
  ]);
  const cfg = {
    template_type: 'auto_confirmation',
    is_active: true,
    google_sheets_url: '',
    admin_whatsapp: '',
    shop_name: 'Boutique',
    custom_prompt: null,
    media_url: null,
    blocked_prefixes: [],
  };
  db.seed('public', 'chatbot_configs', [
    { user_id: T1, ...cfg },
    { user_id: T2, ...cfg },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function seedSession(extra: Record<string, unknown> = {}, tenant = T1, contact = C1) {
  db.seed('public', 'ai_chat_sessions', [
    {
      user_id: tenant,
      channel: 'whatsapp',
      contact_id: contact,
      template_type: 'auto_confirmation',
      conversation: [
        { role: 'user', content: 'nheb montre' },
        { role: 'assistant', content: 'Wach smitek ?' },
      ],
      extracted_data: {},
      updated_at: '2026-09-20T10:00:00.000Z',
      ...extra,
    },
  ]);
}

// ─── Concurrence ─────────────────────────────────────────────────────────────

describe('deux messages concurrents sur la même session', () => {
  for (const order of [
    ['B', 'A'],
    ['A', 'B'],
  ] as const) {
    it(`A lit · B lit · Gemini libère ${order[0]} puis ${order[1]} → aucun message perdu`, async () => {
      seedSession();
      const msgs = { A: 'smiti Amine', B: 'ana f wahran' };
      const a = post(msgs.A);
      const b = post(msgs.B);
      await until(() => pending.length === 2, 'A et B ont lu la session et attendent Gemini');

      release(msgs[order[0]], `ok ${order[0]}`);
      await until(() => waSends.length === 1, `${order[0]} a écrit et répondu`);
      release(msgs[order[1]], `ok ${order[1]}`);
      await Promise.all([a, b]);

      const turns = userTurns(session());
      expect(turns).toContain(msgs.A); // INVARIANT 1
      expect(turns).toContain(msgs.B);
      expect(turns.filter((t: string) => t === msgs.A)).toHaveLength(1); // pas de doublon
      const conv = session()!.conversation;
      expect(conv).toHaveLength(6); // H (2) + 2 tours
      expect(conv[0].content).toBe('nheb montre'); // historique initial intact
      // Chaque réponse suit son message (ordre des tours cohérent).
      for (const k of ['A', 'B'] as const) {
        const i = conv.findIndex((m: any) => m.content === msgs[k]);
        expect(conv[i + 1]).toEqual({ role: 'assistant', content: `ok ${k}` });
      }
      expect(waSends).toHaveLength(2); // les deux clients reçoivent leur réponse
    });
  }

  it('première prise de contact concurrente (session inexistante) → une seule session, deux tours', async () => {
    const a = post('salam, nheb montre');
    const b = post('chhal soumha ?');
    await until(() => pending.length === 2, 'deux lectures sans session');
    release('chhal soumha ?', 'ok B');
    await until(() => waSends.length === 1, 'B écrit');
    release('salam, nheb montre', 'ok A');
    await Promise.all([a, b]);
    const rows = db.all('public', 'ai_chat_sessions');
    expect(rows).toHaveLength(1);
    expect(userTurns(rows[0]).sort()).toEqual(['chhal soumha ?', 'salam, nheb montre']);
  });

  it('données extraites des deux tours fusionnées (pas d’écrasement)', async () => {
    seedSession();
    const a = post('smiti Amine B');
    const b = post('telephone 0550123456');
    await until(() => pending.length === 2, 'lectures');
    release('telephone 0550123456', 'ok <data>{"telephone":"0550123456"}</data>');
    await until(() => waSends.length === 1, 'B écrit');
    release('smiti Amine B', 'ok <data>{"nom":"Amine B"}</data>');
    await Promise.all([a, b]);
    expect(session()!.extracted_data).toMatchObject({ nom: 'Amine B', telephone: '0550123456' });
  });

  it('handover posé pendant une génération n’est pas annulé par l’écriture périmée', async () => {
    seedSession();
    const a = post('wach kayen livraison ?');
    await until(() => pending.length === 1, 'A attend Gemini');
    // Pendant ce temps, un message en colère déclenche le handover humain.
    await post('ntouma nassabin, arnaque !!!');
    expect(session()!.human_handover).toBe(true);
    release('wach kayen livraison ?', 'ok A');
    await a;
    expect(session()!.human_handover).toBe(true); // le bot ne doit pas reprendre la main
  });

  it('compteur de jetons : les deux consommations sont comptées', async () => {
    seedSession({ tokens_used: 100 });
    const a = post('m1');
    const b = post('m2');
    await until(() => pending.length === 2, 'lectures');
    release('m2', 'ok');
    await until(() => waSends.length === 1, 'B écrit');
    release('m1', 'ok');
    await Promise.all([a, b]);
    expect(session()!.tokens_used).toBe(130); // 100 + 2 × 15
  });
});

// ─── Parcours séquentiels et isolation ───────────────────────────────────────

describe('parcours normal et isolation', () => {
  beforeEach(() => {
    autoReply = (u) => `réponse à ${u}`;
  });

  it('conversation normale : session existante, tours ajoutés dans l’ordre', async () => {
    seedSession();
    await post('smiti Amine');
    await post('ana f wahran');
    expect(userTurns(session())).toEqual(['nheb montre', 'smiti Amine', 'ana f wahran']);
  });

  it('session inexistante : créée avec le premier tour', async () => {
    await post('salam nheb montre');
    expect(session()!.conversation).toEqual([
      { role: 'user', content: 'salam nheb montre' },
      { role: 'assistant', content: 'réponse à salam nheb montre' },
    ]);
  });

  it('deux contacts du même tenant : sessions distinctes, jamais mélangées', async () => {
    await Promise.all([post('je suis C1'), post('je suis C2', { contact: C2 })]);
    expect(userTurns(session(T1, C1))).toEqual(['je suis C1']);
    expect(userTurns(session(T1, C2))).toEqual(['je suis C2']);
  });

  it('même contact chez deux tenants : chaque tenant n’écrit que sa session', async () => {
    seedSession({}, T2, C1);
    await Promise.all([post('pour T1'), post('pour T2', { instance: 'zrex_t2_auto' })]);
    expect(userTurns(session(T1, C1))).toEqual(['pour T1']);
    expect(userTurns(session(T2, C1))).toEqual(['nheb montre', 'pour T2']);
  });

  it('même événement rejoué (retry / double webhook) : un seul tour', async () => {
    seedSession();
    await post('smiti Amine', { id: 'EVT-1' });
    await post('smiti Amine', { id: 'EVT-1' });
    expect(userTurns(session()).filter((t: string) => t === 'smiti Amine')).toHaveLength(1);
  });

  it('même événement rejoué EN PARALLÈLE : un seul tour', async () => {
    seedSession();
    await Promise.all([post('dup', { id: 'EVT-2' }), post('dup', { id: 'EVT-2' })]);
    expect(userTurns(session()).filter((t: string) => t === 'dup')).toHaveLength(1);
  });
});

// ─── Échecs ──────────────────────────────────────────────────────────────────

describe('échecs', () => {
  it('échec Gemini : aucun tour écrit, failure_count incrémenté, jetons conservés', async () => {
    seedSession({ failure_count: 0, tokens_used: 7 });
    autoReply = () => null;
    await post('allo ?');
    const s = session()!;
    expect(userTurns(s)).toEqual(['nheb montre']);
    expect(s.failure_count).toBe(1);
    expect(s.tokens_used).toBe(7);
  });

  it('échecs Gemini concurrents : les deux échecs sont comptés', async () => {
    seedSession({ failure_count: 0 });
    const a = post('x1');
    const b = post('x2');
    await until(() => pending.length === 2, 'lectures');
    release('x1', null);
    await until(() => waSends.length === 1, 'A échoue');
    release('x2', null);
    await Promise.all([a, b]);
    expect(session()!.failure_count).toBe(2);
  });

  it('timeout Gemini (réseau) : même traitement qu’un échec, rien de perdu dans l’historique', async () => {
    seedSession();
    fetchMock.mockImplementationOnce(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    autoReply = () => 'ok';
    await post('allo');
    expect(userTurns(session())).toEqual(['nheb montre']);
  });

  it('échec base à l’écriture : journalisé (pas silencieux), réponse quand même envoyée', async () => {
    seedSession();
    autoReply = () => 'ok';
    db.failNext('public', 'ai_chat_sessions', 'update', {
      code: '08006',
      message: 'connection lost',
    });
    const errors: string[] = [];
    vi.mocked(console.error).mockImplementation((l: unknown) => {
      errors.push(String(l));
    });
    await post('m');
    expect(errors.join('\n')).toContain('session_write_failed');
    expect(waSends).toHaveLength(1);
  });

  it('nouveau message après un échec : l’historique reprend normalement', async () => {
    seedSession({ failure_count: 1 });
    autoReply = () => null;
    await post('x');
    autoReply = () => 'ok';
    // failure_count = 2 → handover (comportement existant) : on repart d'un compteur 1.
    db.all('public', 'ai_chat_sessions')[0].failure_count = 1;
    await post('y');
    expect(userTurns(session())).toEqual(['nheb montre', 'y']);
    expect(session()!.failure_count).toBe(0);
  });
});

// ─── commitSession (concurrence optimiste) ───────────────────────────────────

import { commitSession, nextUpdatedAt, type SessionRow } from '@/lib/ai-chatbot/session-store';

describe('commitSession', () => {
  const KEY = { userId: T1, channel: 'whatsapp' as const, contactId: C1 };
  const append = (label: string) => (fresh: SessionRow | null) => ({
    patch: { conversation: [...(fresh?.conversation ?? []), { role: 'user', content: label }] },
    result: label,
  });

  it('conflit de version : écriture refusée sur l’état périmé, relue, fusionnée, puis acceptée', async () => {
    seedSession();
    const seen = { ...db.all('public', 'ai_chat_sessions')[0] } as SessionRow;
    // Un autre écrivain passe entre la lecture et l'écriture.
    Object.assign(db.all('public', 'ai_chat_sessions')[0], {
      updated_at: '2026-09-20T10:00:05.000Z',
      conversation: [...(seen.conversation ?? []), { role: 'user', content: 'autre' }],
    });
    const out = await commitSession(db as never, KEY, seen, append('moi'));
    expect(out).toMatchObject({ ok: true, attempts: 2 });
    expect(userTurns(session())).toEqual(['nheb montre', 'autre', 'moi']);
  });

  it('conflit permanent : abandon après N tentatives, journalisé, rien d’écrasé', async () => {
    seedSession();
    const seen = { ...db.all('public', 'ai_chat_sessions')[0] } as SessionRow;
    let bump = 0;
    const racing = {
      from: (t: string) => {
        const b = db.from(t) as unknown as { update: (p: unknown) => unknown };
        const orig = b.update.bind(b);
        b.update = (p: unknown) => {
          // Un autre écrivain gagne systématiquement la course.
          db.all('public', 'ai_chat_sessions')[0].updated_at = `2026-09-21T00:00:0${bump++}.000Z`;
          return orig(p);
        };
        return b;
      },
    };
    const errors: string[] = [];
    vi.mocked(console.error).mockImplementation((l: unknown) => {
      errors.push(String(l));
    });
    const out = await commitSession(racing as never, KEY, seen, append('moi'), 3);
    expect(out).toMatchObject({ ok: false, reason: 'conflict', attempts: 3 });
    expect(userTurns(session())).toEqual(['nheb montre']);
    expect(errors.join('\n')).toContain('session_conflict_unresolved');
  });

  it('relecture impossible après conflit : db_error, pas de boucle', async () => {
    seedSession();
    const seen = { ...db.all('public', 'ai_chat_sessions')[0], updated_at: 'périmé' } as SessionRow;
    db.failNext('public', 'ai_chat_sessions', 'select', { code: '57014' });
    const out = await commitSession(db as never, KEY, seen, append('moi'));
    expect(out).toMatchObject({ ok: false, reason: 'db_error', error_code: '57014' });
  });

  it('patch null : aucune écriture', async () => {
    const out = await commitSession(db as never, KEY, null, () => ({ patch: null, result: 1 }));
    expect(out).toEqual({ ok: true, result: 1, attempts: 1 });
    expect(db.all('public', 'ai_chat_sessions')).toHaveLength(0);
  });

  it('updated_at strictement croissant, même dans la même milliseconde (pas d’ABA)', () => {
    const t = Date.parse('2026-09-24T10:00:00.000Z');
    expect(nextUpdatedAt('2026-09-24T10:00:00.000Z', t)).toBe('2026-09-24T10:00:00.001Z');
    expect(nextUpdatedAt('2026-09-24T09:00:00.000Z', t)).toBe('2026-09-24T10:00:00.000Z');
    expect(nextUpdatedAt(null, t)).toBe('2026-09-24T10:00:00.000Z');
    expect(nextUpdatedAt('illisible', t)).toBe('2026-09-24T10:00:00.000Z');
  });
});
