// Phase 1 — Intégration du handler `whatsapp.send`.
//
// Le handler RÉEL (src/lib/queue/handlers/whatsapp-send.ts) tourne contre un
// Supabase en mémoire et un Evolution API simulé par `fetch`. Aucun réseau,
// aucun message WhatsApp, aucune écriture dans la vraie base.
//
// Ce que ces tests verrouillent, dans l'ordre d'importance :
//   1. un ÉCHEC n'écrit JAMAIS dans public.messages (cause des 532 471 lignes)
//   2. un succès écrit exactement UNE ligne `envoye`
//   3. max_attempts = 1 → DLQ dès le premier échec, jamais rejoué
//   4. 5 échecs consécutifs → circuit ouvert 30 min, plus aucun appel Evolution
//   5. le plafond journalier est vérifié à l'instant de l'envoi
//   6. toutes les écritures sont scopées au tenant du job

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeSupabase } from '../helpers/fake-supabase';
import { ANTI_SPAM } from '@/lib/whatsapp/anti-spam';
import { CIRCUIT } from '@/lib/queue/circuit-breaker';
import { MAX_ATTEMPTS, type Job } from '@/lib/queue/types';

let fake: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fake,
  createClient: async () => {
    throw new Error('createClient (cookies) ne doit jamais être appelé par la file');
  },
}));

// Importés APRÈS le mock (vi.mock est hissé, l'ordre ici est indicatif).
import { handleWhatsAppSend } from '@/lib/queue/handlers/whatsapp-send';
import { enqueue, claimJobs, markFailed, markDone } from '@/lib/queue/repository';
import { runTick } from '@/lib/queue/runner';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const EVOLUTION_URL = 'https://evolution.test';

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;
let evolutionCalls: Array<{ url: string; body: any }>;

function evolutionResponds(status: number, body = '{}') {
  fetchMock.mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (!url.startsWith(EVOLUTION_URL)) {
      // Garde-fou : AUCUN autre appel réseau n'est toléré.
      throw new Error(`appel réseau interdit en test : ${url}`);
    }
    evolutionCalls.push({ url, body: JSON.parse(init?.body ?? '{}') });
    return new Response(body, { status });
  });
}

function evolutionNetworkError() {
  fetchMock.mockImplementation(async (input: any) => {
    evolutionCalls.push({ url: String(input), body: null });
    throw new Error('ECONNRESET');
  });
}

function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: 'job-test',
    tenant_id: TENANT_A,
    type: 'whatsapp.send',
    payload: {
      phone: '0556 17 26 74',
      message: 'Salam, colis ZR-1 wsel.',
      tracking_number: 'ZR-1',
      customer_name: 'Test',
    },
    status: 'running',
    run_after: new Date().toISOString(),
    attempts: 1,
    max_attempts: 1,
    locked_at: new Date().toISOString(),
    locked_by: 'w',
    last_error: null,
    idempotency_key: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function seedInstance(tenant = TENANT_A) {
  fake.seed('public', 'whatsapp_instances', [
    {
      user_id: tenant,
      instance_name: `inst-${tenant.slice(0, 4)}`,
      service_type: 'auto_confirmation',
      connected: true,
    },
  ]);
}

beforeEach(() => {
  fake = new FakeSupabase();
  evolutionCalls = [];
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('EVOLUTION_API_URL', EVOLUTION_URL);
  vi.stubEnv('EVOLUTION_API_KEY', 'test-key');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Succès — comptabilisation', () => {
  it('appelle Evolution UNE fois (sendText) et écrit UNE ligne `envoye`', async () => {
    seedInstance();
    evolutionResponds(201);

    const r = await handleWhatsAppSend(makeJob());

    expect(r).toEqual({ outcome: 'done' });
    expect(evolutionCalls).toHaveLength(1);
    expect(evolutionCalls[0].url).toBe(`${EVOLUTION_URL}/message/sendText/inst-1111`);
    expect(evolutionCalls[0].body.number).toBe('213556172674'); // normalisé

    const messages = fake.all('public', 'messages');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      user_id: TENANT_A,
      status: 'envoye',
      tracking_number: 'ZR-1',
      customer_whatsapp: '0556 17 26 74',
    });
  });

  it('marque la notification `sent` et referme le circuit', async () => {
    seedInstance();
    evolutionResponds(201);
    const [notif] = fake.seed('public', 'pending_notifications', [
      { user_id: TENANT_A, tracking_number: 'ZR-1', delivery_status: 'livre', status: 'pending' },
    ]);
    fake.seed('autotim', 'tenant_settings', [
      { tenant_id: TENANT_A, consecutive_send_failures: 3, circuit_open_until: null },
    ]);

    await handleWhatsAppSend(
      makeJob({ payload: { ...makeJob().payload, notification_id: notif.id } })
    );

    expect(fake.all('public', 'pending_notifications')[0].status).toBe('sent');
    const ts = fake.all('autotim', 'tenant_settings')[0];
    expect(ts.consecutive_send_failures).toBe(0);
    expect(ts.circuit_open_until).toBeNull();
  });

  it('avec media_url → sendMedia, et trace le destinataire de campagne', async () => {
    seedInstance();
    evolutionResponds(201);

    await handleWhatsAppSend(
      makeJob({
        payload: {
          ...makeJob().payload,
          campaign_id: 'camp-1',
          media_url: 'https://cdn.test/promo.jpg',
        },
      })
    );

    expect(evolutionCalls[0].url).toContain('/message/sendMedia/');
    expect(evolutionCalls[0].body).toMatchObject({ mediatype: 'image', fileName: 'promo.jpg' });
    expect(fake.all('public', 'campaign_recipients')).toHaveLength(1);
    expect(fake.all('public', 'campaign_recipients')[0]).toMatchObject({
      campaign_id: 'camp-1',
      status: 'envoye',
    });
  });

  it('le texte envoyé est varié mais reste le message demandé (anti-dup inchangé)', async () => {
    seedInstance();
    evolutionResponds(201);
    await handleWhatsAppSend(makeJob());
    const sent: string = evolutionCalls[0].body.text;
    // varyMessage n'ajoute que des ZWS et éventuellement un emoji final.
    const ZWS = String.fromCharCode(0x200b);
    expect(sent.split(ZWS).join('').startsWith('Salam, colis ZR-1 wsel.')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Échec — AUCUNE ligne d'échec dans public.messages", () => {
  it('HTTP 500 Evolution → outcome failed, 0 ligne messages, notification `failed`', async () => {
    seedInstance();
    evolutionResponds(500, 'Session WhatsApp expirée (Connection Closed)');
    const [notif] = fake.seed('public', 'pending_notifications', [
      { user_id: TENANT_A, tracking_number: 'ZR-1', delivery_status: 'livre', status: 'pending' },
    ]);

    const r = await handleWhatsAppSend(
      makeJob({ payload: { ...makeJob().payload, notification_id: notif.id } })
    );

    expect(r.outcome).toBe('failed');
    expect((r as any).error).toContain('Evolution HTTP 500');
    expect(fake.all('public', 'messages')).toHaveLength(0); // ← LE test
    expect(fake.all('public', 'pending_notifications')[0].status).toBe('failed');
    expect(fake.all('autotim', 'tenant_settings')[0].consecutive_send_failures).toBe(1);
  });

  it('erreur réseau → même garantie', async () => {
    seedInstance();
    evolutionNetworkError();
    const r = await handleWhatsAppSend(makeJob());
    expect(r.outcome).toBe('failed');
    expect(fake.all('public', 'messages')).toHaveLength(0);
  });

  it('instance absente → failed sans appel Evolution ni ligne messages', async () => {
    evolutionResponds(201);
    const r = await handleWhatsAppSend(makeJob());
    expect(r).toEqual({ outcome: 'failed', error: 'aucune instance WhatsApp connectée' });
    expect(evolutionCalls).toHaveLength(0);
    expect(fake.all('public', 'messages')).toHaveLength(0);
  });

  it('numéro invalide → failed, aucun appel', async () => {
    seedInstance();
    evolutionResponds(201);
    const r = await handleWhatsAppSend(makeJob({ payload: { phone: '12', message: 'x' } }));
    expect(r.outcome).toBe('failed');
    expect(evolutionCalls).toHaveLength(0);
  });

  it('payload incomplet → failed avant toute lecture', async () => {
    const r = await handleWhatsAppSend(makeJob({ payload: { phone: '0556172674' } }));
    expect(r.outcome).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('max_attempts = 1 → DLQ dès le premier échec (via repository réel)', () => {
  it('un envoi échoué part en `dead` et n’est JAMAIS réclamé de nouveau', async () => {
    seedInstance();
    evolutionResponds(500, 'down');
    const db = fake as any;

    const job = await enqueue(db, {
      tenantId: TENANT_A,
      type: 'whatsapp.send',
      payload: makeJob().payload,
      idempotencyKey: 'notif:a:ZR-1:livre',
    });
    expect(job?.max_attempts).toBe(MAX_ATTEMPTS['whatsapp.send']);

    const [claimed] = await claimJobs(db, 5, 'w1');
    expect(claimed.attempts).toBe(1);

    const result = await handleWhatsAppSend(claimed);
    expect(result.outcome).toBe('failed');
    const outcome = await markFailed(db, claimed, (result as any).error);
    expect(outcome).toBe('dead');

    const stored = fake.all('autotim', 'jobs')[0];
    expect(stored.status).toBe('dead');
    expect(stored.last_error).toContain('Evolution HTTP 500');

    // Plus jamais réclamable.
    expect(await claimJobs(db, 5, 'w2')).toEqual([]);
    expect(evolutionCalls).toHaveLength(1); // une seule tentative réelle
    expect(fake.all('public', 'messages')).toHaveLength(0);
  });

  it('runTick : 3 envois échoués → 3 dead, 3 appels Evolution, 0 ligne messages', async () => {
    seedInstance();
    evolutionResponds(500, 'down');
    const db = fake as any;
    for (let i = 0; i < 3; i++) {
      await enqueue(db, {
        tenantId: TENANT_A,
        type: 'whatsapp.send',
        payload: { ...makeJob().payload, tracking_number: `ZR-${i}` },
        idempotencyKey: `notif:a:ZR-${i}:livre`,
      });
    }

    const stats = await runTick({ 'whatsapp.send': handleWhatsAppSend }, 'tick-1');

    expect(stats).toMatchObject({ claimed: 3, done: 0, failed: 0, dead: 3 });
    expect(evolutionCalls).toHaveLength(3);
    expect(fake.all('public', 'messages')).toHaveLength(0);
    expect(fake.all('autotim', 'jobs').every((j) => j.status === 'dead')).toBe(true);

    // Un second tick ne rejoue rien.
    const again = await runTick({ 'whatsapp.send': handleWhatsAppSend }, 'tick-2');
    expect(again.claimed).toBe(0);
    expect(evolutionCalls).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Circuit breaker — 5 échecs consécutifs → ouvert 30 min', () => {
  it("s'ouvre exactement au 5e échec et bloque le 6e envoi sans appel Evolution", async () => {
    seedInstance();
    evolutionResponds(500, 'down');
    const before = Date.now();

    for (let i = 1; i <= CIRCUIT.THRESHOLD; i++) {
      const r = await handleWhatsAppSend(makeJob({ id: `j${i}` }));
      expect(r.outcome).toBe('failed');
      const ts = fake.all('autotim', 'tenant_settings')[0];
      expect(ts.consecutive_send_failures).toBe(i);
      if (i < CIRCUIT.THRESHOLD) expect(ts.circuit_open_until).toBeNull();
    }

    const ts = fake.all('autotim', 'tenant_settings')[0];
    expect(ts.circuit_open_until).not.toBeNull();
    const until = new Date(ts.circuit_open_until).getTime();
    expect(until - before).toBeGreaterThanOrEqual(CIRCUIT.OPEN_MS - 1000);
    expect(until - before).toBeLessThanOrEqual(CIRCUIT.OPEN_MS + 5000);
    expect(evolutionCalls).toHaveLength(CIRCUIT.THRESHOLD);

    // 6e job : reschedule, AUCUN appel supplémentaire, aucune tentative consommée.
    const r6 = await handleWhatsAppSend(makeJob({ id: 'j6' }));
    expect(r6.outcome).toBe('reschedule');
    expect((r6 as any).reason).toContain('circuit ouvert');
    expect((r6 as any).runAfter.getTime()).toBe(until);
    expect(evolutionCalls).toHaveLength(CIRCUIT.THRESHOLD);
    expect(fake.all('public', 'messages')).toHaveLength(0);
  });

  it('via runTick : un job reporté par le circuit revient `pending` sans consommer de tentative', async () => {
    seedInstance();
    evolutionResponds(500, 'down');
    const db = fake as any;
    fake.seed('autotim', 'tenant_settings', [
      {
        tenant_id: TENANT_A,
        consecutive_send_failures: 5,
        circuit_open_until: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    ]);
    await enqueue(db, { tenantId: TENANT_A, type: 'whatsapp.send', payload: makeJob().payload });

    const stats = await runTick({ 'whatsapp.send': handleWhatsAppSend }, 'tick');
    expect(stats).toMatchObject({ claimed: 1, rescheduled: 1, dead: 0, failed: 0 });

    const j = fake.all('autotim', 'jobs')[0];
    expect(j.status).toBe('pending');
    expect(j.attempts).toBe(0); // décrémenté : le report n'est pas un échec
    expect(new Date(j.run_after).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(evolutionCalls).toHaveLength(0);
  });

  it('le circuit est PAR TENANT : le tenant B envoie normalement', async () => {
    seedInstance(TENANT_A);
    seedInstance(TENANT_B);
    evolutionResponds(201);
    fake.seed('autotim', 'tenant_settings', [
      {
        tenant_id: TENANT_A,
        consecutive_send_failures: 5,
        circuit_open_until: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    ]);

    expect((await handleWhatsAppSend(makeJob({ tenant_id: TENANT_A }))).outcome).toBe('reschedule');
    expect((await handleWhatsAppSend(makeJob({ tenant_id: TENANT_B }))).outcome).toBe('done');
    expect(evolutionCalls).toHaveLength(1);
    expect(evolutionCalls[0].url).toContain('inst-2222');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Plafond journalier — vérifié à l'instant de l'envoi", () => {
  function seedSent(tenant: string, n: number, agoMs = 60_000) {
    fake.seed(
      'public',
      'messages',
      Array.from({ length: n }, (_, i) => ({
        user_id: tenant,
        status: 'envoye',
        sent_at: new Date(Date.now() - agoMs - i).toISOString(),
      }))
    );
  }

  it(`à ${ANTI_SPAM.DAILY_LIMIT} envois sur 24 h → reschedule, aucun appel`, async () => {
    seedInstance();
    evolutionResponds(201);
    seedSent(TENANT_A, ANTI_SPAM.DAILY_LIMIT);

    const r = await handleWhatsAppSend(makeJob());
    expect(r.outcome).toBe('reschedule');
    expect((r as any).reason).toBe('plafond journalier atteint');
    expect(evolutionCalls).toHaveLength(0);
    expect(fake.all('public', 'messages')).toHaveLength(ANTI_SPAM.DAILY_LIMIT); // rien ajouté
  });

  it(`à ${ANTI_SPAM.DAILY_LIMIT - 1} envois → passe`, async () => {
    seedInstance();
    evolutionResponds(201);
    seedSent(TENANT_A, ANTI_SPAM.DAILY_LIMIT - 1);
    expect((await handleWhatsAppSend(makeJob())).outcome).toBe('done');
  });

  it('les échecs (`echec`) et les envois de plus de 24 h ne comptent pas', async () => {
    seedInstance();
    evolutionResponds(201);
    seedSent(TENANT_A, ANTI_SPAM.DAILY_LIMIT, 25 * 3600_000); // vieux
    fake.seed(
      'public',
      'messages',
      Array.from({ length: 100 }, () => ({
        user_id: TENANT_A,
        status: 'echec',
        sent_at: new Date().toISOString(),
      }))
    );
    expect((await handleWhatsAppSend(makeJob())).outcome).toBe('done');
  });

  it('warm-up jour 1 : plafond 8', async () => {
    seedInstance();
    evolutionResponds(201);
    fake.seed('public', 'profiles', [
      { id: TENANT_A, whatsapp_warmup_started_at: new Date(Date.now() - 3600_000).toISOString() },
    ]);
    seedSent(TENANT_A, 8);
    const r = await handleWhatsAppSend(makeJob());
    expect(r.outcome).toBe('reschedule');
    expect(evolutionCalls).toHaveLength(0);
  });

  it('le plafond est PAR TENANT : les envois de B ne bloquent pas A', async () => {
    seedInstance();
    evolutionResponds(201);
    seedSent(TENANT_B, ANTI_SPAM.DAILY_LIMIT + 10);
    expect((await handleWhatsAppSend(makeJob())).outcome).toBe('done');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Isolation tenant', () => {
  it("n'utilise que l'instance du tenant du job", async () => {
    seedInstance(TENANT_B); // seul B a une instance
    evolutionResponds(201);
    const r = await handleWhatsAppSend(makeJob({ tenant_id: TENANT_A }));
    expect(r).toEqual({ outcome: 'failed', error: 'aucune instance WhatsApp connectée' });
    expect(evolutionCalls).toHaveLength(0);
  });

  it('ne modifie pas une notification appartenant à un autre tenant', async () => {
    seedInstance();
    evolutionResponds(201);
    const [notifB] = fake.seed('public', 'pending_notifications', [
      { user_id: TENANT_B, tracking_number: 'ZR-9', delivery_status: 'livre', status: 'pending' },
    ]);

    // Un payload (corrompu ou malveillant) qui pointe la notification de B.
    await handleWhatsAppSend(
      makeJob({
        tenant_id: TENANT_A,
        payload: { ...makeJob().payload, notification_id: notifB.id },
      })
    );

    expect(fake.all('public', 'pending_notifications')[0].status).toBe('pending'); // intacte
    expect(fake.all('public', 'messages')[0].user_id).toBe(TENANT_A);
  });

  it('toutes les écritures portent le tenant du job', async () => {
    seedInstance();
    evolutionResponds(201);
    await handleWhatsAppSend(makeJob({ tenant_id: TENANT_A }));
    for (const w of fake.writes) {
      for (const row of w.rows) {
        const owner = row.user_id ?? row.tenant_id;
        if (owner !== undefined) expect(owner).toBe(TENANT_A);
      }
    }
    expect(fake.writes.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Cycle complet via runTick', () => {
  it('succès → done, ligne messages, tenant_settings à zéro', async () => {
    seedInstance();
    evolutionResponds(201);
    const db = fake as any;
    await enqueue(db, {
      tenantId: TENANT_A,
      type: 'whatsapp.send',
      payload: makeJob().payload,
      idempotencyKey: 'notif:a:ZR-1:livre',
    });

    const stats = await runTick({ 'whatsapp.send': handleWhatsAppSend }, 'tick');
    expect(stats).toMatchObject({ claimed: 1, done: 1, failed: 0, dead: 0, rescheduled: 0 });

    const j = fake.all('autotim', 'jobs')[0];
    expect(j).toMatchObject({ status: 'done', attempts: 1, locked_at: null, locked_by: null });
    expect(fake.all('public', 'messages')).toHaveLength(1);
    await markDone(db, j.id); // idempotent
  });
});
