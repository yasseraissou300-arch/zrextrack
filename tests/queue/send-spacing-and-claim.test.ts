// File autotim — deux chemins de (ré)envoi démontrés sur le code d'avant :
//
//  A. BURST : le tick (toutes les 5 min) exécutait à la suite tous les
//     whatsapp.send devenus dus → N messages en quelques secondes malgré le
//     throttle 20-60 s posé par le dispatcher de campagne.
//  B. REJEU : la prise d'un job et l'incrément de `attempts` étaient deux
//     UPDATE ; si le second échouait (504) et que la fonction mourait après
//     l'envoi, la reprise du verrou mort relançait le message.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeSupabase } from '../helpers/fake-supabase';

let fake: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fake,
  createClient: async () => {
    throw new Error('interdit dans la file');
  },
}));

import { enqueue, claimJobs, recoverStaleLocks, STALE_LOCK_MINUTES } from '@/lib/queue/repository';
import { runTick } from '@/lib/queue/runner';
import { handleWhatsAppSend } from '@/lib/queue/handlers/whatsapp-send';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const EVOLUTION_URL = 'https://evolution.test';

let sends: Array<{ url: string; number: string }>;

beforeEach(() => {
  fake = new FakeSupabase();
  sends = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (!url.startsWith(EVOLUTION_URL)) throw new Error(`réseau interdit : ${url}`);
      sends.push({ url, number: JSON.parse(init?.body ?? '{}').number });
      return new Response('{}', { status: 201 });
    })
  );
  vi.stubEnv('EVOLUTION_API_URL', EVOLUTION_URL);
  vi.stubEnv('EVOLUTION_API_KEY', 'test-key');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const t of [TENANT_A, TENANT_B]) {
    fake.seed('public', 'whatsapp_instances', [
      { user_id: t, instance_name: `inst-${t.slice(0, 4)}`, service_type: 'auto_confirmation' },
    ]);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function enqueueSends(tenant: string, n: number) {
  for (let i = 0; i < n; i++) {
    await enqueue(fake as any, {
      tenantId: tenant,
      type: 'whatsapp.send',
      payload: { phone: `05500000${String(i).padStart(2, '0')}`, message: `m${i}` },
      runAfter: new Date(Date.now() - 1000),
    });
  }
}

const handlers = { 'whatsapp.send': handleWhatsAppSend };

describe('A — espacement : jamais de rafale dans un même tick', () => {
  it('5 envois dus pour un tenant → 1 seul part, les 4 autres sont reportés', async () => {
    await enqueueSends(TENANT_A, 5);

    const stats = await runTick(handlers, 'w1');

    expect(sends).toHaveLength(1);
    expect(stats.done).toBe(1);
    expect(stats.rescheduled).toBe(4);
    const pending = fake.all('autotim', 'jobs').filter((j) => j.status === 'pending');
    expect(pending).toHaveLength(4);
    // Un report ne consomme pas de tentative : aucun job ne s'approche de la DLQ.
    expect(pending.every((j) => j.attempts === 0)).toBe(true);
    // Report d'au moins 20 s après l'envoi réussi.
    const sentAt = Date.parse(fake.all('public', 'messages')[0].sent_at);
    expect(pending.every((j) => Date.parse(j.run_after) >= sentAt + 20_000)).toBe(true);
  });

  it('l’espacement est par tenant : deux tenants envoient chacun un message', async () => {
    await enqueueSends(TENANT_A, 2);
    await enqueueSends(TENANT_B, 2);
    await runTick(handlers, 'w1');
    expect(sends.map((s) => s.url.split('/').pop()).sort()).toEqual(['inst-1111', 'inst-2222']);
  });
});

describe('B — prise atomique : un envoi n’est jamais rejoué', () => {
  it('statut et tentative écrits en UNE seule requête', async () => {
    await enqueueSends(TENANT_A, 1);
    const before = fake.writes.length;
    const [job] = await claimJobs(fake as any, 5, 'w1');
    const jobWrites = fake.writes.slice(before).filter((w) => w.table === 'autotim.jobs');
    expect(jobWrites).toHaveLength(1);
    expect(job.attempts).toBe(1);
    expect(fake.all('autotim', 'jobs')[0].attempts).toBe(1);
  });

  it('2e UPDATE en échec + fonction tuée après l’envoi → reprise sans renvoi', async () => {
    await enqueueSends(TENANT_A, 1);

    // L'ancien code faisait deux UPDATE par prise : le 2e (attempts) échoue.
    fake.failNth('autotim', 'jobs', 'update', 2, { code: '504', message: 'Gateway Timeout' });
    const [job] = await claimJobs(fake as any, 5, 'w1');
    fake.clearFailures();

    // Le handler envoie… puis la fonction meurt avant markDone.
    await handleWhatsAppSend(job);
    expect(sends).toHaveLength(1);

    // Verrou mort, repris par un tick ultérieur.
    const row = fake.all('autotim', 'jobs')[0];
    row.locked_at = new Date(Date.now() - (STALE_LOCK_MINUTES + 1) * 60_000).toISOString();
    expect(await recoverStaleLocks(fake as any)).toBe(1);
    // Même 20 s plus tard, l'espacement ne doit pas être ce qui protège ici.
    fake.all('public', 'messages')[0].sent_at = new Date(Date.now() - 60_000).toISOString();

    const stats = await runTick(handlers, 'w2');

    expect(sends).toHaveLength(1); // jamais renvoyé
    expect(stats.dead).toBe(1); // DLQ, décision humaine
  });
});
