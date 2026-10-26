// P1-1 (préparé, NON déployé pendant la fenêtre 72 h v2) — reprise unique sur
// 5xx de la passerelle Supabase pour les requêtes idempotentes du tick.
//
// Motif mesuré le 2026-09-13 : une requête PostgREST reçoit 504 « Gateway
// Timeout » après ~5 s (SQL réel ≤ 2 ms), la suivante réussit.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeSupabase } from '../helpers/fake-supabase';

let fake: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => fake }));
const logs: Array<{ scope: string; fields: Record<string, unknown> }> = [];
vi.mock('@/lib/security/safe-log', () => ({
  logEvent: (_l: string, scope: string, fields: Record<string, unknown>) =>
    logs.push({ scope, fields }),
}));

const { claimJobs, recoverStaleLocks, listServerSyncTenants } =
  await import('@/lib/queue/repository');
const db = () => fake as any;
const GATEWAY = { message: 'Gateway Timeout', code: '' };

beforeEach(() => {
  fake = new FakeSupabase();
  logs.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const run = async <T>(p: Promise<T>) => {
  await vi.runAllTimersAsync();
  return p;
};

describe('reprise unique sur 504 passerelle', () => {
  it('listServerSyncTenants : 504 puis succès → résultat normal, reprise journalisée', async () => {
    fake.seed('autotim', 'tenant_settings', [
      { tenant_id: 't1', auto_sync_enabled: true, sync_source: 'server' },
    ]);
    fake.failNext('autotim', 'tenant_settings', 'select', GATEWAY);
    const res = await run(listServerSyncTenants(db()));
    expect(res.map((t) => t.tenant_id)).toEqual(['t1']);
    expect(logs.map((l) => l.fields.status)).toEqual(['retry', 'retry_ok']);
  });

  it('deux 504 consécutifs → l’erreur remonte (tick 500, jamais masqué)', async () => {
    fake.failNext('autotim', 'tenant_settings', 'select', GATEWAY);
    fake.failNext('autotim', 'tenant_settings', 'select', GATEWAY);
    const done = expect(listServerSyncTenants(db())).rejects.toThrow('Gateway Timeout');
    await vi.runAllTimersAsync();
    await done;
    expect(logs.map((l) => l.fields.status)).toEqual(['retry', 'retry_failed']);
  });

  it('erreur NON passerelle (ex. permission) → aucune reprise', async () => {
    fake.failNext('autotim', 'tenant_settings', 'select', {
      message: 'permission denied for table tenant_settings',
      code: '42501',
    });
    const done = expect(listServerSyncTenants(db())).rejects.toThrow('permission denied');
    await vi.runAllTimersAsync();
    await done;
    expect(logs).toHaveLength(0);
  });

  it('recoverStaleLocks : 504 puis succès → verrous morts libérés une seule fois', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    fake.seed('autotim', 'jobs', [
      {
        tenant_id: 't',
        type: 'zrexpress.sync',
        status: 'running',
        locked_at: old,
        locked_by: 'w',
        attempts: 1,
        max_attempts: 3,
      },
    ]);
    fake.failNext('autotim', 'jobs', 'update', GATEWAY);
    expect(await run(recoverStaleLocks(db()))).toBe(1);
    expect(fake.all('autotim', 'jobs')[0].status).toBe('pending');
  });

  it('claimJobs : 504 sur la sélection puis succès → le job est réclamé une seule fois', async () => {
    fake.seed('autotim', 'jobs', [
      {
        tenant_id: 't',
        type: 'zrexpress.sync',
        status: 'pending',
        run_after: new Date(Date.now() - 1000).toISOString(),
        attempts: 0,
        max_attempts: 3,
      },
    ]);
    fake.failNext('autotim', 'jobs', 'select', GATEWAY);
    const jobs = await run(claimJobs(db(), 5, 'w1'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].attempts).toBe(1);
    expect(fake.all('autotim', 'jobs')[0].status).toBe('running');
  });
});
