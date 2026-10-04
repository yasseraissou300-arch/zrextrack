// P4 — AUDIT (constat, aucun code modifié) : anti-rejeu de twilio-guard.
//
// guardTwilioRequest (src/lib/security/twilio-guard.ts) déduplique avec
// isReplay() (src/lib/security/webhook-auth.ts) :
//   clé  = `twilio:<scope>:<CallSid>:<CallStatus | Digits | ''>`
//   lieu = Map en MÉMOIRE du module, propre à chaque instance serverless
//   durée = 10 min (REPLAY_TTL_MS), et seulement tant que l'instance vit
//   condition = uniquement si CallSid est présent
//   moment = la clé est posée APRÈS la vérification de signature et AVANT
//            l'action métier (mise à jour de voice_calls).
// Ces tests PROUVENT ses limites ; ils décrivent le comportement ACTUEL.
// Une « nouvelle instance » est simulée par vi.resetModules() : le module est
// rechargé, sa Map repart vide — exactement ce que voit un démarrage à froid.
// Aucun Twilio réel, aucun secret réel, aucune production.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { computeTwilioSignature } from '@/lib/security/twilio-signature';

let db: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => db,
}));

const BASE = 'https://app.test';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN: Record<string, string> = {
  [TENANT_A]: 'auth-token-test-A',
  [TENANT_B]: 'auth-token-test-B',
};
const CALL_SID = 'CA0123456789abcdef0123456789abcdef';

type Route = 'status' | 'gather' | 'twiml';
type Mod = { POST: (r: NextRequest) => Promise<Response> };

/** Charge la route dans une « instance » : après resetModules, Map neuve. */
async function instance(route: Route): Promise<Mod> {
  return (await import(`@/app/api/voice-calls/${route}/route`)) as Mod;
}
async function newInstance(route: Route): Promise<Mod> {
  vi.resetModules();
  return instance(route);
}

/** Requête Twilio signée avec l'Auth Token du tenant (comme le vrai Twilio). */
function twilioRequest(
  route: Route,
  cid: string,
  params: Record<string, string>,
  tenant = TENANT_A
) {
  const url = `${BASE}/api/voice-calls/${route}?cid=${cid}`;
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': computeTwilioSignature(TOKEN[tenant], url, params),
    },
    body: new URLSearchParams(params).toString(),
  });
}

/** Mises à jour réellement écrites dans voice_calls (= exécutions de l'action métier). */
let updates: Array<Record<string, unknown>> = [];
const call = (cid = CID_A) => db.all('public', 'voice_calls').find((c) => c.id === cid);
const fetchMock = vi.fn(async () => new Response('{}'));

beforeEach(() => {
  db = new FakeSupabase();
  updates = [];
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', BASE);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  db.seed('public', 'voice_calls', [
    {
      id: CID_A,
      user_id: TENANT_A,
      customer_name: 'Client A',
      amount: 2500,
      tracking_number: 'ZR-1',
      status: 'queued',
      outcome: null,
    },
    {
      id: CID_B,
      user_id: TENANT_B,
      customer_name: 'Client B',
      amount: 1800,
      tracking_number: 'ZR-2',
      status: 'queued',
      outcome: null,
    },
  ]);
  db.seed('public', 'voice_call_settings', [
    {
      user_id: TENANT_A,
      auth_token: TOKEN[TENANT_A],
      message_template: 'Salam {name}',
      voice: 'Polly.Hala-Neural',
      shop_name: 'A',
    },
    {
      user_id: TENANT_B,
      auth_token: TOKEN[TENANT_B],
      message_template: 'Salam {name}',
      voice: 'Polly.Hala-Neural',
      shop_name: 'B',
    },
  ]);
  const from = db.from.bind(db);
  vi.spyOn(db, 'from').mockImplementation((t: string) => {
    const b = from(t) as unknown as { update: (p: Record<string, unknown>) => unknown };
    if (t === 'voice_calls') {
      const update = b.update.bind(b);
      b.update = (p) => {
        updates.push(p);
        return update(p);
      };
    }
    return b as never;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const RINGING = { CallSid: CALL_SID, CallStatus: 'ringing' };
const COMPLETED = { CallSid: CALL_SID, CallStatus: 'completed', CallDuration: '42' };

describe('A — même événement, même instance', () => {
  it('2e réception < 10 min → 409 replay, action exécutée UNE fois', async () => {
    const A = await instance('status');
    expect((await A.POST(twilioRequest('status', CID_A, COMPLETED))).status).toBe(200);
    expect((await A.POST(twilioRequest('status', CID_A, COMPLETED))).status).toBe(409);
    expect(updates).toHaveLength(1);
  });

  it('2e réception APRÈS 10 min (TTL) → considéré nouveau, action exécutée DEUX fois', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
    const A = await instance('status');
    await A.POST(twilioRequest('status', CID_A, COMPLETED));
    vi.setSystemTime(new Date('2026-10-04T10:11:00Z'));
    expect((await A.POST(twilioRequest('status', CID_A, COMPLETED))).status).toBe(200);
    expect(updates).toHaveLength(2);
  });
});

describe('B/C — mémoire perdue ou autre instance', () => {
  it('B — même événement après démarrage à froid → nouveau, action exécutée DEUX fois', async () => {
    const A = await instance('status');
    await A.POST(twilioRequest('status', CID_A, COMPLETED));
    const B = await newInstance('status');
    expect((await B.POST(twilioRequest('status', CID_A, COMPLETED))).status).toBe(200);
    expect(updates).toHaveLength(2);
  });

  it('C — deux contextes vivants en parallèle (instances A et B) → chacun l’accepte', async () => {
    const A = await instance('gather');
    const B = await newInstance('gather');
    const digits = { CallSid: CALL_SID, Digits: '1' };
    expect((await A.POST(twilioRequest('gather', CID_A, digits))).status).toBe(200);
    expect((await B.POST(twilioRequest('gather', CID_A, digits))).status).toBe(200);
    expect(updates).toEqual([{ outcome: 'confirmed' }, { outcome: 'confirmed' }]);
  });
});

describe('D — concurrence', () => {
  it('même instance, 2 requêtes simultanées → une seule passe (vérification synchrone)', async () => {
    const A = await instance('status');
    const [r1, r2] = await Promise.all([
      A.POST(twilioRequest('status', CID_A, COMPLETED)),
      A.POST(twilioRequest('status', CID_A, COMPLETED)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(updates).toHaveLength(1);
  });

  it('deux instances, 2 requêtes simultanées → les DEUX passent', async () => {
    const A = await instance('status');
    const B = await newInstance('status');
    const [r1, r2] = await Promise.all([
      A.POST(twilioRequest('status', CID_A, COMPLETED)),
      B.POST(twilioRequest('status', CID_A, COMPLETED)),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(updates).toHaveLength(2);
  });
});

describe('E/F — événements différents, identifiant absent', () => {
  it('E — même appel, statuts différents → deux événements distincts, tous deux traités', async () => {
    const A = await instance('status');
    expect((await A.POST(twilioRequest('status', CID_A, RINGING))).status).toBe(200);
    expect((await A.POST(twilioRequest('status', CID_A, COMPLETED))).status).toBe(200);
    expect(updates.map((u) => u.status)).toEqual(['ringing', 'completed']);
  });

  it('F — sans CallSid : AUCUNE déduplication, même dans la même instance', async () => {
    const A = await instance('gather');
    const noSid = { Digits: '1' };
    expect((await A.POST(twilioRequest('gather', CID_A, noSid))).status).toBe(200);
    expect((await A.POST(twilioRequest('gather', CID_A, noSid))).status).toBe(200);
    expect(updates).toHaveLength(2);
  });
});

describe('G — multi-tenant', () => {
  it('la clé ne contient PAS le tenant : même CallSid chez B → bloqué comme rejeu de A', async () => {
    // Twilio garantit l'unicité globale des CallSid : ce cas suppose un CallSid
    // fabriqué (requête de B signée avec le jeton de B). Effet : faux positif
    // (événement légitime de B ignoré), jamais une écriture chez A.
    const A = await instance('status');
    expect((await A.POST(twilioRequest('status', CID_A, COMPLETED, TENANT_A))).status).toBe(200);
    expect((await A.POST(twilioRequest('status', CID_B, COMPLETED, TENANT_B))).status).toBe(409);
    expect(call(CID_B)?.status).toBe('queued');
  });
});

describe('H — effet métier réel d’un rejeu non bloqué', () => {
  it('statut : « ringing » rejoué sur une nouvelle instance APRÈS « completed » → statut régresse', async () => {
    const A = await instance('status');
    await A.POST(twilioRequest('status', CID_A, RINGING));
    await A.POST(twilioRequest('status', CID_A, COMPLETED));
    expect(call()?.status).toBe('completed');
    // Même instance, < 10 min : rejeu bloqué, état préservé.
    expect((await A.POST(twilioRequest('status', CID_A, RINGING))).status).toBe(409);
    expect(call()?.status).toBe('completed');
    // Démarrage à froid : le MÊME événement « ringing » est accepté.
    const B = await newInstance('status');
    expect((await B.POST(twilioRequest('status', CID_A, RINGING))).status).toBe(200);
    expect(call()?.status).toBe('ringing'); // régression d'état
    expect(call()?.completed_at).toBeTruthy(); // incohérent : « ringing » mais terminé
  });

  it('statut « completed » rejoué → completed_at réécrit (horodatage déplacé), durée/coût identiques', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
    const A = await instance('status');
    await A.POST(twilioRequest('status', CID_A, COMPLETED));
    const first = { ...call() };
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    const B = await newInstance('status');
    await B.POST(twilioRequest('status', CID_A, COMPLETED));
    expect(call()?.completed_at).not.toBe(first.completed_at);
    expect(call()?.duration_seconds).toBe(first.duration_seconds);
    expect(call()?.cost_da).toBe(first.cost_da);
  });

  it('gather rejoué → même outcome réécrit (idempotent en valeur) ; twiml rejoué → aucune écriture', async () => {
    const G1 = await instance('gather');
    await G1.POST(twilioRequest('gather', CID_A, { CallSid: CALL_SID, Digits: '2' }));
    const G2 = await newInstance('gather');
    await G2.POST(twilioRequest('gather', CID_A, { CallSid: CALL_SID, Digits: '2' }));
    expect(call()?.outcome).toBe('cancelled');
    const before = updates.length;
    const T1 = await newInstance('twiml');
    const r = await T1.POST(twilioRequest('twiml', CID_A, { CallSid: CALL_SID }));
    expect(r.status).toBe(200);
    expect(updates.length).toBe(before);
  });

  it('aucun envoi sortant (WhatsApp, SMS, appel, facturation) dans ces routes, même en rejeu', async () => {
    const A = await instance('status');
    await A.POST(twilioRequest('status', CID_A, COMPLETED));
    const B = await newInstance('gather');
    await B.POST(twilioRequest('gather', CID_A, { CallSid: CALL_SID, Digits: '1' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.all('public', 'messages')).toHaveLength(0);
  });
});

describe('constat annexe — signature non appliquée sans Auth Token (hors anti-rejeu)', () => {
  it('tenant sans auth_token : requête NON signée acceptée (unenforced) et outcome écrit', async () => {
    db = new FakeSupabase();
    db.seed('public', 'voice_calls', [
      { id: CID_A, user_id: TENANT_A, customer_name: 'Client A', status: 'queued', outcome: null },
    ]);
    db.seed('public', 'voice_call_settings', [{ user_id: TENANT_A, auth_token: null }]);
    const G = await newInstance('gather');
    const forged = new NextRequest(`${BASE}/api/voice-calls/gather?cid=${CID_A}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ CallSid: CALL_SID, Digits: '1' }).toString(),
    });
    expect((await G.POST(forged)).status).toBe(200);
    expect(db.all('public', 'voice_calls')[0].outcome).toBe('confirmed');
  });
});
