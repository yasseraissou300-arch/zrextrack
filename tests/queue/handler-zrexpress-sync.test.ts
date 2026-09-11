// Phase 1 — Intégration du handler `zrexpress.sync`.
//
// Le handler RÉEL tourne contre un Supabase en mémoire ; `fetchAllParcels` est
// remplacé par un mock (aucun appel à api.zrexpress.app). Aucun envoi
// WhatsApp n'a lieu : le handler ne fait qu'ENFILER des jobs whatsapp.send.
//
// Verrouillé ici :
//   - détection de changement de statut → pending_notifications → job enfilé
//   - clé d'idempotence notif:<tenant>:<tracking>:<statut> → jamais deux jobs
//   - NOTIFS_PER_SYNC = 2 et espacement croissant des run_after
//   - quota mensuel → reschedule (pas un échec), ZR non appelé
//   - retry : 3 tentatives (MAX_ATTEMPTS) puis DLQ, via le repository réel
//   - isolation : les commandes d'un autre tenant ne sont ni lues ni écrites

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeSupabase } from '../helpers/fake-supabase';
import { PLAN_QUOTAS } from '@/lib/plan-quotas';
import { MAX_ATTEMPTS, type Job } from '@/lib/queue/types';
import { notificationKey } from '@/lib/queue/idempotency';

let fake: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fake,
}));

vi.mock('@/lib/zrexpress/parcels', () => ({
  ZREXPRESS_API: 'https://api.zrexpress.test',
  fetchAllParcels: vi.fn(),
}));

import { fetchAllParcels } from '@/lib/zrexpress/parcels';
import { handleZrexpressSync } from '@/lib/queue/handlers/zrexpress-sync';
import { enqueue, claimJobs, markFailed } from '@/lib/queue/repository';
import { runTick } from '@/lib/queue/runner';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const parcelsMock = vi.mocked(fetchAllParcels);

/** Colis ZRExpress minimal, au format que mapParcel sait lire. */
function parcel(tracking: string, state: string, over: Record<string, any> = {}) {
  return {
    trackingNumber: tracking,
    customer: { name: `Client ${tracking}`, phone: { number1: '0556172674' } },
    deliveryAddress: { city: 'Alger' },
    productsDescription: 'Produit',
    price: 2500,
    state,
    situation: '',
    ...over,
  };
}

function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: 'sync-job',
    tenant_id: TENANT_A,
    type: 'zrexpress.sync',
    payload: {},
    status: 'running',
    run_after: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
    locked_at: new Date().toISOString(),
    locked_by: 'w',
    last_error: null,
    idempotency_key: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function seedTenant(tenant = TENANT_A, planId = 'basic') {
  fake.seed('public', 'user_sync_settings', [
    {
      user_id: tenant,
      zrexpress_token: 'tok',
      zrexpress_tenant_id: 'zr-tenant',
      notify_enabled: {},
    },
  ]);
  fake.seed('public', 'profiles', [{ id: tenant, plan_id: planId, role: null }]);
}

beforeEach(() => {
  fake = new FakeSupabase();
  parcelsMock.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      throw new Error(`appel réseau interdit en test : ${String(input)}`);
    })
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Chemin nominal', () => {
  it('nouvelle commande livrée → orders + pending_notifications + job whatsapp.send', async () => {
    seedTenant();
    parcelsMock.mockResolvedValue([parcel('ZR-1', 'Livré')]);

    const r = await handleZrexpressSync(makeJob());

    expect(r).toEqual({ outcome: 'done' });
    expect(parcelsMock).toHaveBeenCalledWith('tok', 'zr-tenant');

    const orders = fake.all('public', 'orders');
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      user_id: TENANT_A,
      tracking_number: 'ZR-1',
      delivery_status: 'livre',
    });

    const notifs = fake.all('public', 'pending_notifications');
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      user_id: TENANT_A,
      tracking_number: 'ZR-1',
      delivery_status: 'livre',
    });

    const jobs = fake.all('autotim', 'jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      tenant_id: TENANT_A,
      type: 'whatsapp.send',
      status: 'pending',
      max_attempts: MAX_ATTEMPTS['whatsapp.send'],
      idempotency_key: notificationKey(TENANT_A, 'ZR-1', 'livre'),
    });
    expect(jobs[0].payload).toMatchObject({
      notification_id: notifs[0].id,
      phone: '0556172674',
      tracking_number: 'ZR-1',
    });
    expect(String(jobs[0].payload.message)).toContain('ZR-1');
    // Premier envoi ≥ 5 s après le sync — jamais immédiat.
    expect(new Date(jobs[0].run_after).getTime() - Date.now()).toBeGreaterThanOrEqual(4_000);

    expect(fake.all('autotim', 'tenant_settings')[0].last_synced_at).not.toBeNull();
  });

  it('statut inchangé → rien à notifier, aucun nouveau job', async () => {
    seedTenant();
    fake.seed('public', 'orders', [
      { user_id: TENANT_A, tracking_number: 'ZR-1', delivery_status: 'livre' },
    ]);
    parcelsMock.mockResolvedValue([parcel('ZR-1', 'Livré')]);

    await handleZrexpressSync(makeJob());

    expect(fake.all('public', 'pending_notifications')).toHaveLength(0);
    expect(fake.all('autotim', 'jobs')).toHaveLength(0);
    expect(fake.all('public', 'orders')).toHaveLength(1); // upsert, pas de doublon
  });

  it('statut non notifiable (en préparation) → commande enregistrée, pas de notification', async () => {
    seedTenant();
    parcelsMock.mockResolvedValue([parcel('ZR-2', 'En préparation')]);
    await handleZrexpressSync(makeJob());
    expect(fake.all('public', 'orders')).toHaveLength(1);
    expect(fake.all('public', 'pending_notifications')).toHaveLength(0);
    expect(fake.all('autotim', 'jobs')).toHaveLength(0);
  });

  it('notification désactivée par le tenant pour ce statut → pas de job', async () => {
    fake.seed('public', 'user_sync_settings', [
      {
        user_id: TENANT_A,
        zrexpress_token: 'tok',
        zrexpress_tenant_id: 'zr-tenant',
        notify_enabled: { livre: false },
      },
    ]);
    fake.seed('public', 'profiles', [{ id: TENANT_A, plan_id: 'basic' }]);
    parcelsMock.mockResolvedValue([parcel('ZR-1', 'Livré')]);
    await handleZrexpressSync(makeJob());
    expect(fake.all('autotim', 'jobs')).toHaveLength(0);
  });

  it('aucun colis → done, last_synced_at mis à jour, rien d’autre', async () => {
    seedTenant();
    parcelsMock.mockResolvedValue([]);
    expect(await handleZrexpressSync(makeJob())).toEqual({ outcome: 'done' });
    expect(fake.all('autotim', 'tenant_settings')[0].last_synced_at).not.toBeNull();
    expect(fake.all('public', 'orders')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Idempotence — même clé → un seul job', () => {
  it('deux syncs successifs avec le même changement ne créent qu’un job', async () => {
    seedTenant();
    parcelsMock.mockResolvedValue([parcel('ZR-1', 'Livré')]);

    await handleZrexpressSync(makeJob());
    // Simule un second sync (navigateur + cron dans le même créneau) : la
    // notification est encore `pending` → on tente de ré-enfiler.
    fake.seed('public', 'orders', []); // no-op, juste pour la lisibilité
    // On remet la commande à un ancien statut pour re-déclencher la détection.
    const o = fake.all('public', 'orders')[0];
    o.delivery_status = 'en_transit';
    await handleZrexpressSync(makeJob({ id: 'sync-job-2' }));

    const jobs = fake.all('autotim', 'jobs');
    expect(jobs).toHaveLength(1); // ← la clé notif:… a dédupliqué
    expect(fake.all('public', 'pending_notifications')).toHaveLength(1); // uniq_pending_notif
  });

  it('enqueue direct de la même clé renvoie null (ON CONFLICT DO NOTHING)', async () => {
    const db = fake as any;
    const key = notificationKey(TENANT_A, 'ZR-1', 'livre');
    const first = await enqueue(db, {
      tenantId: TENANT_A,
      type: 'whatsapp.send',
      idempotencyKey: key,
    });
    const second = await enqueue(db, {
      tenantId: TENANT_A,
      type: 'whatsapp.send',
      idempotencyKey: key,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(fake.all('autotim', 'jobs')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Rythme — NOTIFS_PER_SYNC = 2, espacement 20-60 s', () => {
  it('5 changements → 2 jobs au premier sync, 2 au second, 1 au troisième', async () => {
    seedTenant();
    parcelsMock.mockResolvedValue([1, 2, 3, 4, 5].map((i) => parcel(`ZR-${i}`, 'Livré')));

    await handleZrexpressSync(makeJob());
    expect(fake.all('public', 'pending_notifications')).toHaveLength(5);
    expect(fake.all('autotim', 'jobs')).toHaveLength(2);

    // Les jobs suivants ne sont enfilés que quand les précédents sont partis :
    // on simule l'envoi en marquant les 2 premières notifications `sent`.
    for (const n of fake.all('public', 'pending_notifications').slice(0, 2)) n.status = 'sent';
    await handleZrexpressSync(makeJob({ id: 's2' }));
    expect(fake.all('autotim', 'jobs')).toHaveLength(4);

    for (const n of fake.all('public', 'pending_notifications').slice(2, 4)) n.status = 'sent';
    await handleZrexpressSync(makeJob({ id: 's3' }));
    expect(fake.all('autotim', 'jobs')).toHaveLength(5);

    // Aucun doublon de clé.
    const keys = fake.all('autotim', 'jobs').map((j) => j.idempotency_key);
    expect(new Set(keys).size).toBe(5);
  });

  it('les run_after sont strictement croissants, écartés de 20 à 60 s', async () => {
    seedTenant();
    parcelsMock.mockResolvedValue([parcel('ZR-1', 'Livré'), parcel('ZR-2', 'Livré')]);
    await handleZrexpressSync(makeJob());
    const [a, b] = fake
      .all('autotim', 'jobs')
      .map((j) => new Date(j.run_after).getTime())
      .sort((x, y) => x - y);
    expect(b - a).toBeGreaterThanOrEqual(20_000);
    expect(b - a).toBeLessThanOrEqual(60_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Quota mensuel du plan', () => {
  it('plan basic saturé → reschedule au mois suivant, ZR NON appelé', async () => {
    seedTenant(TENANT_A, 'basic');
    const quota = PLAN_QUOTAS.basic as number;
    fake.seed(
      'public',
      'orders',
      Array.from({ length: quota }, (_, i) => ({
        user_id: TENANT_A,
        tracking_number: `OLD-${i}`,
        created_at: new Date().toISOString(),
      }))
    );

    const r = await handleZrexpressSync(makeJob());

    expect(r.outcome).toBe('reschedule');
    expect((r as any).reason).toContain('quota mensuel atteint');
    expect((r as any).runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(parcelsMock).not.toHaveBeenCalled();
  });

  it('les commandes d’un autre tenant ne consomment pas le quota', async () => {
    seedTenant(TENANT_A, 'basic');
    const quota = PLAN_QUOTAS.basic as number;
    fake.seed(
      'public',
      'orders',
      Array.from({ length: quota + 50 }, (_, i) => ({
        user_id: TENANT_B,
        tracking_number: `B-${i}`,
        created_at: new Date().toISOString(),
      }))
    );
    parcelsMock.mockResolvedValue([parcel('ZR-1', 'Livré')]);
    expect((await handleZrexpressSync(makeJob())).outcome).toBe('done');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Retry — MAX_ATTEMPTS = 3 puis DLQ (repository + runner réels)', () => {
  it('ZRExpress en erreur : 3 tentatives, backoff croissant, puis dead', async () => {
    seedTenant();
    parcelsMock.mockRejectedValue(new Error('ZREXpress API error 503: maintenance'));
    const db = fake as any;

    const job = await enqueue(db, {
      tenantId: TENANT_A,
      type: 'zrexpress.sync',
      idempotencyKey: 'sync:a:1',
    });
    expect(job?.max_attempts).toBe(MAX_ATTEMPTS['zrexpress.sync']);

    const runAfters: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      // On rend le job dû (le backoff l'a repoussé dans le futur).
      fake.all('autotim', 'jobs')[0].run_after = new Date(Date.now() - 1000).toISOString();
      const stats = await runTick({ 'zrexpress.sync': handleZrexpressSync }, `tick-${attempt}`);
      const j = fake.all('autotim', 'jobs')[0];
      expect(j.attempts).toBe(attempt);
      expect(j.last_error).toContain('503');
      if (attempt < 3) {
        expect(stats).toMatchObject({ claimed: 1, failed: 1, dead: 0 });
        expect(j.status).toBe('pending');
        runAfters.push(new Date(j.run_after).getTime() - Date.now());
      } else {
        expect(stats).toMatchObject({ claimed: 1, failed: 0, dead: 1 });
        expect(j.status).toBe('dead');
      }
    }

    expect(parcelsMock).toHaveBeenCalledTimes(3);
    // Backoff : ~30 s puis ~60 s (± 20 % de jitter).
    expect(runAfters[0]).toBeGreaterThanOrEqual(24_000 - 1000);
    expect(runAfters[0]).toBeLessThanOrEqual(36_000 + 1000);
    expect(runAfters[1]).toBeGreaterThanOrEqual(48_000 - 1000);
    expect(runAfters[1]).toBeLessThanOrEqual(72_000 + 1000);

    // Mort = plus jamais réclamé.
    fake.all('autotim', 'jobs')[0].run_after = new Date(0).toISOString();
    expect((await runTick({ 'zrexpress.sync': handleZrexpressSync }, 'tick-4')).claimed).toBe(0);
    expect(parcelsMock).toHaveBeenCalledTimes(3);
  });

  it('token manquant → failed (tentative consommée), pas d’appel ZR', async () => {
    fake.seed('public', 'profiles', [{ id: TENANT_A, plan_id: 'basic' }]);
    const db = fake as any;
    await enqueue(db, { tenantId: TENANT_A, type: 'zrexpress.sync' });
    const [claimed] = await claimJobs(db, 1, 'w');
    const r = await handleZrexpressSync(claimed);
    expect(r).toEqual({ outcome: 'failed', error: 'token ou tenant ZRExpress non configuré' });
    expect(await markFailed(db, claimed, (r as any).error)).toBe('failed');
    expect(parcelsMock).not.toHaveBeenCalled();
  });

  it('erreur d’upsert orders → failed, aucune notification enfilée', async () => {
    seedTenant();
    parcelsMock.mockResolvedValue([parcel('ZR-1', 'Livré')]);
    fake.failNext('public', 'orders', 'upsert', {
      code: '42703',
      message: 'column does not exist',
    });
    const r = await handleZrexpressSync(makeJob());
    expect(r.outcome).toBe('failed');
    expect((r as any).error).toContain('upsert orders');
    expect(fake.all('autotim', 'jobs')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Isolation tenant', () => {
  it('la commande d’un autre tenant avec le même tracking est ignorée et non modifiée', async () => {
    seedTenant(TENANT_A);
    const [orderB] = fake.seed('public', 'orders', [
      { user_id: TENANT_B, tracking_number: 'ZR-1', delivery_status: 'livre', customer_name: 'B' },
    ]);
    parcelsMock.mockResolvedValue([parcel('ZR-1', 'Livré')]);

    await handleZrexpressSync(makeJob({ tenant_id: TENANT_A }));

    const orders = fake.all('public', 'orders');
    expect(orders).toHaveLength(2); // B intacte + A créée
    expect(orders.find((o) => o.user_id === TENANT_B)).toMatchObject({
      id: orderB.id,
      customer_name: 'B',
    });
    // Pour A c'est un NOUVEAU statut (B ne compte pas) → notification pour A seulement.
    const notifs = fake.all('public', 'pending_notifications');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].user_id).toBe(TENANT_A);
    expect(fake.all('autotim', 'jobs')[0].tenant_id).toBe(TENANT_A);
  });

  it('les credentials ZR lus sont ceux du tenant du job', async () => {
    fake.seed('public', 'user_sync_settings', [
      { user_id: TENANT_B, zrexpress_token: 'tok-B', zrexpress_tenant_id: 'zr-B' },
    ]);
    fake.seed('public', 'profiles', [{ id: TENANT_A, plan_id: 'basic' }]);
    const r = await handleZrexpressSync(makeJob({ tenant_id: TENANT_A }));
    expect(r.outcome).toBe('failed'); // A n'a pas de token → jamais celui de B
    expect(parcelsMock).not.toHaveBeenCalled();
  });

  it('toutes les écritures portent le tenant du job', async () => {
    seedTenant();
    parcelsMock.mockResolvedValue([parcel('ZR-1', 'Livré'), parcel('ZR-2', 'Retour')]);
    await handleZrexpressSync(makeJob());
    expect(fake.writes.length).toBeGreaterThan(0);
    for (const w of fake.writes) {
      for (const row of w.rows) {
        const owner = row.user_id ?? row.tenant_id;
        expect(owner).toBe(TENANT_A);
      }
    }
  });
});
