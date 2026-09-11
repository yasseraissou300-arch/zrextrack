// Phase 1 — Intégration repository.ts + runner.ts contre le Supabase en mémoire.
//
// Contrairement à job-lifecycle.test.ts (qui rejoue la sémantique dans une
// classe de test), ici c'est le VRAI code de src/lib/queue/repository.ts et
// runner.ts qui s'exécute, avec les mêmes chaînes PostgREST qu'en production,
// et les contraintes CHECK de la migration appliquées par le fake.
//
// Verrouillé :
//   - stale lock : un job `running` depuis > 5 min est repris, < 5 min non
//   - compare-and-swap : deux workers ne prennent jamais le même job
//   - isolation : le tick ne fait tourner un job qu'avec SON tenant_id ; un
//     handler ne peut pas s'exécuter sous l'identité d'un autre tenant
//   - budget du tick : les jobs non démarrés sont rendus sans tentative
//   - un handler qui lève ne fait pas tomber le tick

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeSupabase } from '../helpers/fake-supabase';
import type { Job, JobHandler } from '@/lib/queue/types';

let fake: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fake,
}));

import {
  enqueue,
  claimJobs,
  markDone,
  markFailed,
  markRescheduled,
  recoverStaleLocks,
  listServerSyncTenants,
  upsertTenantSettings,
  setSyncSource,
  STALE_LOCK_MINUTES,
} from '@/lib/queue/repository';
import { runTick, TICK } from '@/lib/queue/runner';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const db = () => fake as any;

beforeEach(() => {
  fake = new FakeSupabase();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Stale lock — reprise des verrous morts (> 5 min)', () => {
  it(`libère un job running depuis ${STALE_LOCK_MINUTES + 1} min, pas un job de ${STALE_LOCK_MINUTES - 1} min`, async () => {
    const old = new Date(Date.now() - (STALE_LOCK_MINUTES + 1) * 60_000).toISOString();
    const recent = new Date(Date.now() - (STALE_LOCK_MINUTES - 1) * 60_000).toISOString();
    fake.seed('autotim', 'jobs', [
      {
        tenant_id: TENANT_A,
        type: 'zrexpress.sync',
        status: 'running',
        locked_at: old,
        locked_by: 'mort',
        attempts: 1,
      },
      {
        tenant_id: TENANT_A,
        type: 'zrexpress.sync',
        status: 'running',
        locked_at: recent,
        locked_by: 'vivant',
        attempts: 1,
      },
      { tenant_id: TENANT_B, type: 'whatsapp.send', status: 'pending', max_attempts: 1 },
    ]);

    const n = await recoverStaleLocks(db());

    expect(n).toBe(1);
    const jobs = fake.all('autotim', 'jobs');
    const repris = jobs.find(
      (j) => j.locked_by === null && j.status === 'pending' && j.type === 'zrexpress.sync'
    )!;
    expect(repris).toBeDefined();
    expect(repris.attempts).toBe(1); // la tentative interrompue reste comptée
    expect(jobs.find((j) => j.locked_by === 'vivant')!.status).toBe('running');
  });

  it('un job repris est de nouveau réclamable, et le compteur de tentatives continue', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    fake.seed('autotim', 'jobs', [
      {
        tenant_id: TENANT_A,
        type: 'zrexpress.sync',
        status: 'running',
        locked_at: old,
        locked_by: 'mort',
        attempts: 1,
        max_attempts: 3,
        run_after: old,
      },
    ]);
    await recoverStaleLocks(db());
    const [j] = await claimJobs(db(), 5, 'w2');
    expect(j).toBeDefined();
    expect(j.attempts).toBe(2);
    expect(j.locked_by).toBe('w2');
  });

  it('un worker tué sur un whatsapp.send : repris puis DLQ SANS ré-exécuter le handler (jamais 2 envois)', async () => {
    // Scénario : Vercel a tué la fonction APRÈS l'appel Evolution mais AVANT
    // markDone. Le message est peut-être parti. Le rejouer = doublon = ban.
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    fake.seed('autotim', 'jobs', [
      {
        tenant_id: TENANT_A,
        type: 'whatsapp.send',
        status: 'running',
        locked_at: old,
        locked_by: 'mort',
        attempts: 1,
        max_attempts: 1,
        run_after: old,
      },
    ]);
    await recoverStaleLocks(db());

    const handler = vi.fn<JobHandler>(async () => ({ outcome: 'done' }));
    const stats = await runTick({ 'whatsapp.send': handler }, 'tick-2');

    expect(handler).not.toHaveBeenCalled(); // ← l'invariant
    expect(stats).toMatchObject({ claimed: 1, dead: 1, done: 0 });
    const j = fake.all('autotim', 'jobs')[0];
    expect(j.status).toBe('dead');
    expect(j.attempts).toBe(2); // = max_attempts + 1, autorisé par jobs_attempts_chk
    expect(j.last_error).toContain('verrou mort');
  });

  it('un zrexpress.sync tué à sa 3e tentative n’est pas exécuté une 4e fois', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    fake.seed('autotim', 'jobs', [
      {
        tenant_id: TENANT_A,
        type: 'zrexpress.sync',
        status: 'running',
        locked_at: old,
        locked_by: 'mort',
        attempts: 3,
        max_attempts: 3,
        run_after: old,
      },
    ]);
    await recoverStaleLocks(db());
    const handler = vi.fn<JobHandler>(async () => ({ outcome: 'done' }));
    await runTick({ 'zrexpress.sync': handler }, 'tick');
    expect(handler).not.toHaveBeenCalled();
    expect(fake.all('autotim', 'jobs')[0].status).toBe('dead');
  });

  it('un zrexpress.sync tué à sa 1re tentative EST rejoué (il reste des tentatives)', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    fake.seed('autotim', 'jobs', [
      {
        tenant_id: TENANT_A,
        type: 'zrexpress.sync',
        status: 'running',
        locked_at: old,
        locked_by: 'mort',
        attempts: 1,
        max_attempts: 3,
        run_after: old,
      },
    ]);
    await recoverStaleLocks(db());
    const handler = vi.fn<JobHandler>(async () => ({ outcome: 'done' }));
    await runTick({ 'zrexpress.sync': handler }, 'tick');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fake.all('autotim', 'jobs')[0]).toMatchObject({ status: 'done', attempts: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Compare-and-swap — exclusivité', () => {
  it('deux workers concurrents ne réclament jamais le même job', async () => {
    for (let i = 0; i < 6; i++) {
      await enqueue(db(), { tenantId: TENANT_A, type: 'zrexpress.sync', idempotencyKey: `k${i}` });
    }
    const [a, b] = await Promise.all([claimJobs(db(), 5, 'w-a'), claimJobs(db(), 5, 'w-b')]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length); // aucun doublon
    expect(ids.length).toBe(6);
    for (const j of fake.all('autotim', 'jobs')) {
      expect(j.status).toBe('running');
      expect(j.locked_at).not.toBeNull();
      expect(['w-a', 'w-b']).toContain(j.locked_by);
    }
  });

  it('un job déjà running est ignoré même s’il est « dû »', async () => {
    fake.seed('autotim', 'jobs', [
      {
        tenant_id: TENANT_A,
        type: 'zrexpress.sync',
        status: 'running',
        locked_at: new Date().toISOString(),
        locked_by: 'x',
        attempts: 1,
      },
    ]);
    expect(await claimJobs(db(), 5, 'w')).toEqual([]);
  });

  it('ne réclame pas un job dont run_after est dans le futur', async () => {
    await enqueue(db(), {
      tenantId: TENANT_A,
      type: 'zrexpress.sync',
      runAfter: new Date(Date.now() + 60_000),
    });
    expect(await claimJobs(db(), 5, 'w')).toEqual([]);
  });

  it('les plus anciens d’abord, dans la limite demandée', async () => {
    const t = Date.now();
    for (let i = 0; i < 4; i++) {
      await enqueue(db(), {
        tenantId: TENANT_A,
        type: 'zrexpress.sync',
        idempotencyKey: `k${i}`,
        runAfter: new Date(t - (10 - i) * 1000),
      });
    }
    const claimed = await claimJobs(db(), 2, 'w');
    expect(claimed.map((j) => j.idempotency_key)).toEqual(['k0', 'k1']);
  });

  it('les contraintes de cohérence du verrou sont respectées à chaque transition', async () => {
    const job = (await enqueue(db(), { tenantId: TENANT_A, type: 'zrexpress.sync' }))!;
    const [c] = await claimJobs(db(), 1, 'w');
    expect(c.status === 'running' && c.locked_at !== null).toBe(true);
    await markRescheduled(db(), c, new Date(Date.now() + 1000), 'attente');
    let s = fake.all('autotim', 'jobs')[0];
    expect(s.status === 'pending' && s.locked_at === null && s.attempts === 0).toBe(true);
    s.run_after = new Date(0).toISOString();
    const [c2] = await claimJobs(db(), 1, 'w');
    await markDone(db(), c2.id);
    s = fake.all('autotim', 'jobs')[0];
    expect(s).toMatchObject({
      id: job.id,
      status: 'done',
      locked_at: null,
      locked_by: null,
      attempts: 1,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Isolation tenant dans le tick', () => {
  it('chaque handler reçoit un job portant SON tenant — jamais celui d’un autre', async () => {
    await enqueue(db(), { tenantId: TENANT_A, type: 'zrexpress.sync', idempotencyKey: 'a' });
    await enqueue(db(), { tenantId: TENANT_B, type: 'zrexpress.sync', idempotencyKey: 'b' });
    const seen: string[] = [];
    const handler: JobHandler = async (job: Job) => {
      seen.push(job.tenant_id);
      return { outcome: 'done' };
    };
    const stats = await runTick({ 'zrexpress.sync': handler }, 'tick');
    expect(stats.done).toBe(2);
    expect(seen.sort()).toEqual([TENANT_A, TENANT_B].sort());
  });

  it('l’échec du tenant A ne touche pas le job de B', async () => {
    await enqueue(db(), { tenantId: TENANT_A, type: 'whatsapp.send', idempotencyKey: 'a' });
    await enqueue(db(), { tenantId: TENANT_B, type: 'whatsapp.send', idempotencyKey: 'b' });
    const handler: JobHandler = async (job) =>
      job.tenant_id === TENANT_A ? { outcome: 'failed', error: 'boom A' } : { outcome: 'done' };
    const stats = await runTick({ 'whatsapp.send': handler }, 'tick');
    expect(stats).toMatchObject({ dead: 1, done: 1 });
    const byTenant = Object.fromEntries(
      fake.all('autotim', 'jobs').map((j) => [j.tenant_id, j.status])
    );
    expect(byTenant).toEqual({ [TENANT_A]: 'dead', [TENANT_B]: 'done' });
  });

  it('seuls les tenants server/both avec auto_sync sont planifiés par le cron', async () => {
    await upsertTenantSettings(db(), TENANT_A, { auto_sync_enabled: true, sync_source: 'server' });
    await upsertTenantSettings(db(), TENANT_B, { auto_sync_enabled: true, sync_source: 'client' });
    await upsertTenantSettings(db(), '33333333-3333-4333-8333-333333333333', {
      auto_sync_enabled: false,
      sync_source: 'both',
    });
    const list = await listServerSyncTenants(db());
    expect(list.map((t) => t.tenant_id)).toEqual([TENANT_A]);

    await setSyncSource(db(), TENANT_B, 'both');
    expect((await listServerSyncTenants(db())).map((t) => t.tenant_id).sort()).toEqual(
      [TENANT_A, TENANT_B].sort()
    );
  });

  it('un sync_source invalide est refusé par la contrainte (comme en base)', async () => {
    await expect(setSyncSource(db(), TENANT_A, 'navigateur' as any)).rejects.toThrow(
      /tenant_settings_source_chk/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('runTick — budget et robustesse', () => {
  it('sans handler pour le type → failed puis dead, jamais planté', async () => {
    await enqueue(db(), { tenantId: TENANT_A, type: 'campaign.dispatch', maxAttempts: 1 });
    const stats = await runTick({}, 'tick');
    expect(stats).toMatchObject({ claimed: 1, dead: 1 });
    expect(fake.all('autotim', 'jobs')[0].last_error).toContain('aucun handler');
  });

  it('un handler qui lève → tentative consommée, le tick continue', async () => {
    await enqueue(db(), { tenantId: TENANT_A, type: 'zrexpress.sync', idempotencyKey: 'a' });
    await enqueue(db(), { tenantId: TENANT_A, type: 'zrexpress.sync', idempotencyKey: 'b' });
    let n = 0;
    const handler: JobHandler = async () => {
      if (++n === 1) throw new Error('crash inattendu');
      return { outcome: 'done' };
    };
    const stats = await runTick({ 'zrexpress.sync': handler }, 'tick');
    expect(stats).toMatchObject({ claimed: 2, failed: 1, done: 1 });
    const failed = fake.all('autotim', 'jobs').find((j) => j.status === 'pending')!;
    expect(failed.last_error).toBe('crash inattendu');
    expect(failed.attempts).toBe(1);
  });

  it('budget épuisé : les jobs réclamés mais non démarrés sont rendus sans tentative', async () => {
    for (let i = 0; i < 3; i++) {
      await enqueue(db(), { tenantId: TENANT_A, type: 'zrexpress.sync', idempotencyKey: `k${i}` });
    }
    // Le tick a démarré il y a (BUDGET - RESERVE - 1 ms) : un seul job peut
    // démarrer, ensuite plus de marge.
    let calls = 0;
    const startedAt = Date.now() - (TICK.BUDGET_MS - TICK.RESERVE_MS - 50);
    const handler: JobHandler = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 80)); // consomme la marge restante
      return { outcome: 'done' };
    };
    const stats = await runTick({ 'zrexpress.sync': handler }, 'tick', startedAt);
    expect(calls).toBe(1);
    expect(stats.budget_exhausted).toBe(true);
    expect(stats.done).toBe(1);
    expect(stats.rescheduled).toBe(2);
    const pending = fake.all('autotim', 'jobs').filter((j) => j.status === 'pending');
    expect(pending).toHaveLength(2);
    expect(pending.every((j) => j.attempts === 0 && j.locked_at === null)).toBe(true);
  });

  it('tick à vide → aucune écriture', async () => {
    const stats = await runTick({}, 'tick');
    expect(stats).toEqual({
      claimed: 0,
      done: 0,
      failed: 0,
      dead: 0,
      rescheduled: 0,
      budget_exhausted: false,
    });
    expect(fake.writes).toHaveLength(0);
  });
});
