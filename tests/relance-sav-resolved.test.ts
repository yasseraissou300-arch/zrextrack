// P4 — Relance SAV d'une réclamation déjà RÉSOLUE par l'opérateur.
//
// Chaîne simulée (base en mémoire, Evolution factice, aucun envoi réel) :
//   réclamation SAV → opérateur « Remboursement » (route resolve, message de
//   résolution au client) → le client répond « merci » (le chatbot repasse
//   is_complete à false, comme pour toute réponse sans bloc <data>) →
//   inactivité ≥ 2 h → runRelance.
//
// INVARIANT : une réclamation résolue (resolution non NULL) n'est jamais
// relancée par « wach mazal 3andek mushkil? ». Une réclamation NON résolue et
// incomplète reste relancée (comportement inchangé).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
const T = '11111111-1111-4111-8111-111111111111';
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: T } } }) },
    from: (t: string) => db.from(t),
  }),
}));
vi.mock('@/lib/user-creds', () => ({
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'global-key' }),
}));

const SID = '33333333-3333-4333-8333-333333333333';
const NUMBER = '213550000002';
const waSends: Array<{ number: string; text: string }> = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith('https://evolution.test/message/sendText/')) {
    waSends.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  }
  return new Response('{}');
});

let resolvePOST: (req: NextRequest) => Promise<Response>;
let runRelance: typeof import('@/lib/ai-chatbot/relance').runRelance;
let RELANCE_MESSAGES: Record<string, string>;
beforeAll(async () => {
  ({ POST: resolvePOST } = await import('@/app/api/ai-chatbot/reclamations/resolve/route'));
  ({ runRelance, RELANCE_MESSAGES } = await import('@/lib/ai-chatbot/relance'));
});

const session = () => db.all('public', 'ai_chat_sessions')[0];
const THREE_HOURS_AGO = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const savRelances = () =>
  waSends.filter((s) => s.text === RELANCE_MESSAGES.sav && s.number === NUMBER);

function seedSav(extra: Record<string, unknown> = {}) {
  db.seed('public', 'ai_chat_sessions', [
    {
      id: SID,
      user_id: T,
      channel: 'whatsapp',
      contact_id: `${NUMBER}@s.whatsapp.net`,
      contact_name: 'Client',
      template_type: 'sav',
      conversation: [],
      extracted_data: { nom: 'Client', probleme: 'colis abîmé' },
      is_complete: true,
      sheets_sent: false,
      human_handover: false,
      relance_sent: false,
      resolution: null,
      updated_at: THREE_HOURS_AGO(),
      ...extra,
    },
  ]);
}

async function resolve(resolution: 'exchange' | 'refund' | 'resolved') {
  return resolvePOST(
    new NextRequest('https://app.test/api/ai-chatbot/reclamations/resolve', {
      method: 'POST',
      body: JSON.stringify({ sessionId: SID, resolution }),
    })
  );
}

/** Effet d'un « merci » du client sur la session (patch du webhook chatbot). */
function clientSaysThanks() {
  session().is_complete = false;
}

async function relance(opts: { dryRun?: boolean } = {}) {
  waSends.length = 0;
  return runRelance(db as never, T, opts);
}

beforeEach(() => {
  db = new FakeSupabase();
  waSends.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
  db.seed('public', 'whatsapp_instances', [
    { user_id: T, service_type: 'sav', instance_name: 'zrex_t_sav', connected: true },
  ]);
  db.seed('public', 'profiles', [{ id: T, whatsapp_warmup_started_at: null }]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('relance SAV — réclamation résolue', () => {
  it.each(['exchange', 'refund', 'resolved'] as const)(
    'résolue (%s) puis « merci » puis 3 h d’inactivité → AUCUNE relance',
    async (resolution) => {
      seedSav();
      const res = await resolve(resolution);
      expect(res.status).toBe(200);
      expect(session().resolution).toBe(resolution);
      clientSaysThanks();
      session().updated_at = THREE_HOURS_AGO();

      const r = await relance();
      expect(savRelances()).toHaveLength(0);
      expect(r.relanced).toBe(0);
      expect(session().relance_sent).toBe(false);
    }
  );

  it('résolue alors que la réclamation était encore incomplète → AUCUNE relance', async () => {
    seedSav({ is_complete: false, resolution: 'resolved', resolved_at: THREE_HOURS_AGO() });
    await relance();
    expect(savRelances()).toHaveLength(0);
  });

  it('dry_run : une réclamation résolue n’est pas comptée comme éligible', async () => {
    seedSav({ is_complete: false, resolution: 'refund' });
    const r = await relance({ dryRun: true });
    expect(r.eligible).toBe(0);
  });

  it('prise atomique : résolue ENTRE le balayage et la prise → AUCUNE relance', async () => {
    seedSav({ is_complete: false });
    // L'opérateur résout pendant que la relance tourne : simulé en résolvant
    // juste après la lecture de l'instance (dernier aller-retour avant la prise).
    const from = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation((t: string) => {
      if (t === 'whatsapp_instances') session().resolution = 'resolved';
      return from(t);
    });
    await relance();
    expect(savRelances()).toHaveLength(0);
    expect(session().relance_sent).toBe(false);
  });

  it('contrôle : réclamation NON résolue, incomplète, inactive → relancée une fois', async () => {
    seedSav({ is_complete: false });
    const r = await relance();
    expect(r.relanced).toBe(1);
    expect(savRelances()).toHaveLength(1);
    expect(session().relance_sent).toBe(true);
  });
});
