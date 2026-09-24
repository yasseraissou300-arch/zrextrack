// P2-8 — Rétention de autotim.jobs, contre le Supabase en mémoire (contraintes
// de 002 appliquées). Données entièrement synthétiques.
//
// Garanties verrouillées :
//   - jobs actifs (pending / running / verrou mort / failed) jamais supprimés
//   - DLQ conservée selon la politique ; whatsapp.send et campaign.dispatch
//     jamais supprimés (leur clé d'idempotence est la seule barrière anti-doublon)
//   - après nettoyage, un ré-enfilement d'une notification déjà traitée reste
//     dédupliqué
//   - simulation par défaut, gel respecté, --confirm / --backup-confirmed
//   - nettoyage idempotent ; un job modifié entre plan et suppression épargné
//   - absence du privilège DELETE (situation réelle, 002b) : arrêt propre

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FakeSupabase, type Row } from '../helpers/fake-supabase';

let fake: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => fake }));

import {
  classifyJob,
  planRetention,
  applyRetention,
  executeRetention,
  RETENTION_POLICY,
  TEST_TENANT_ID,
  FREEZE_UNTIL,
  type RetentionJob,
} from '@/lib/queue/retention';
import { enqueue } from '@/lib/queue/repository';
import {
  syncKey,
  notificationKey,
  campaignRecipientKey,
  SYNC_SLOT_SECONDS,
} from '@/lib/queue/idempotency';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-10T12:00:00Z'); // après le gel
const FROZEN = new Date('2026-09-25T12:00:00Z'); // pendant le gel
const DAY = 86_400_000;
const ago = (days: number, from = NOW) => new Date(from.getTime() - days * DAY);
const iso = (d: Date) => d.toISOString();

function job(p: Partial<RetentionJob> & { daysAgo: number }): RetentionJob {
  const at = ago(p.daysAgo);
  const type = p.type ?? 'zrexpress.sync';
  const tenant = p.tenant_id ?? T1;
  return {
    id: p.id ?? crypto.randomUUID(),
    tenant_id: tenant,
    type,
    status: p.status ?? 'done',
    updated_at: p.updated_at ?? iso(at),
    idempotency_key:
      p.idempotency_key !== undefined
        ? p.idempotency_key
        : type === 'zrexpress.sync'
          ? syncKey(tenant, at)
          : null,
    payload: p.payload ?? {},
  };
}

/** Ligne complète pour le fake (contraintes 002 : verrou ⇔ running). */
function row(j: RetentionJob): Row {
  return {
    ...j,
    created_at: j.updated_at,
    run_after: j.updated_at,
    attempts: j.status === 'pending' ? 0 : 1,
    max_attempts: j.type === 'whatsapp.send' ? 1 : 3,
    locked_at: j.status === 'running' ? j.updated_at : null,
    locked_by: j.status === 'running' ? 'worker-x' : null,
  };
}

const APPLY_OK = ['--apply', '--backup-confirmed'];
const ids = () => new Set(fake.all('autotim', 'jobs').map((r) => r.id));

beforeEach(() => {
  fake = new FakeSupabase();
});

// ─── Politique, job par job ──────────────────────────────────────────────────

describe('classifyJob — jamais supprimés', () => {
  it.each([
    ['pending très ancien', { status: 'pending', daysAgo: 400 }],
    ['running, verrou mort depuis 30 j', { status: 'running', daysAgo: 30 }],
    ['failed ancien', { status: 'failed', daysAgo: 400 }],
    ['statut inconnu', { status: 'weird' as never, daysAgo: 400 }],
    ['whatsapp.send done 400 j', { type: 'whatsapp.send', daysAgo: 400 }],
    ['whatsapp.send dead 400 j', { type: 'whatsapp.send', status: 'dead', daysAgo: 400 }],
    ['campaign.dispatch done 400 j', { type: 'campaign.dispatch', daysAgo: 400 }],
    ['type inconnu', { type: 'other' as never, daysAgo: 400 }],
    ['sync done 13 j (trop récent)', { daysAgo: 13 }],
    ['sync dead 89 j (DLQ conservée)', { status: 'dead', daysAgo: 89 }],
    [
      'sync dont la clé appartient à un autre tenant',
      { daysAgo: 400, idempotency_key: syncKey(T2, ago(400)) },
    ],
    [
      'sync dont la clé est du créneau courant',
      { daysAgo: 400, idempotency_key: syncKey(T1, NOW) },
    ],
    ['sync dont la clé est au format inattendu', { daysAgo: 400, idempotency_key: 'autre:chose' }],
    ['date illisible', { daysAgo: 0, updated_at: 'pas une date' }],
  ] as Array<[string, Partial<RetentionJob> & { daysAgo: number }]>)('%s', (_label, p) => {
    expect(classifyJob(job(p), NOW).action).toBe('keep');
  });
});

describe('classifyJob — supprimables', () => {
  it('sync done au-delà de 14 j', () => {
    expect(classifyJob(job({ daysAgo: 15 }), NOW)).toEqual({
      action: 'delete',
      reason: 'sync_done_expired',
    });
  });
  it('sync dead au-delà de 90 j', () => {
    expect(classifyJob(job({ status: 'dead', daysAgo: 91 }), NOW).action).toBe('delete');
  });
  it('sync sans clé, ancien', () => {
    expect(classifyJob(job({ daysAgo: 30, idempotency_key: null }), NOW).action).toBe('delete');
  });
  it('résidu du test d’intégration (tenant réservé + payload __test__)', () => {
    const j = job({
      tenant_id: TEST_TENANT_ID,
      type: 'whatsapp.send',
      daysAgo: 2,
      payload: { __test__: true },
    });
    expect(classifyJob(j, NOW)).toEqual({ action: 'delete', reason: 'test_residue' });
  });
  it('tenant réservé SANS marqueur __test__ : règles normales (whatsapp.send conservé)', () => {
    const j = job({ tenant_id: TEST_TENANT_ID, type: 'whatsapp.send', daysAgo: 400 });
    expect(classifyJob(j, NOW).action).toBe('keep');
  });
});

// ─── Scénario complet contre la base en mémoire ──────────────────────────────

function seedMixed() {
  const keep = [
    job({ status: 'pending', daysAgo: 400 }),
    job({ status: 'running', daysAgo: 30 }),
    job({
      type: 'whatsapp.send',
      daysAgo: 400,
      idempotency_key: notificationKey(T1, 'TRK1', 'livre'),
    }),
    job({
      type: 'whatsapp.send',
      status: 'dead',
      daysAgo: 400,
      idempotency_key: campaignRecipientKey('c1', '213555000001'),
    }),
    job({ type: 'campaign.dispatch', daysAgo: 400, idempotency_key: 'campdisp:c1:0' }),
    job({ daysAgo: 3 }),
    job({ status: 'dead', daysAgo: 30 }),
  ];
  const del = [
    job({ daysAgo: 20 }),
    job({ daysAgo: 60, tenant_id: T2 }),
    job({ status: 'dead', daysAgo: 120 }),
    job({
      tenant_id: TEST_TENANT_ID,
      daysAgo: 5,
      payload: { __test__: true },
      idempotency_key: 'test:real:x:1',
    }),
  ];
  fake.seed('autotim', 'jobs', [...keep, ...del].map(row));
  return { keep, del };
}

describe('executeRetention — simulation par défaut', () => {
  it('sans --apply : plan chiffré, AUCUNE écriture', async () => {
    const { del } = seedMixed();
    const before = fake.all('autotim', 'jobs');
    const r = await executeRetention([], fake as never, NOW);
    expect(r.exitCode).toBe(0);
    expect(r.output.mode).toBe('simulation');
    expect((r.output.plan as { plannedDeletes: number }).plannedDeletes).toBe(del.length);
    expect(fake.writes).toHaveLength(0);
    expect(fake.all('autotim', 'jobs')).toEqual(before);
  });

  it('le rapport ne contient aucun id ni aucune clé d’idempotence', async () => {
    const { keep, del } = seedMixed();
    const out = JSON.stringify((await executeRetention([], fake as never, NOW)).output);
    for (const j of [...keep, ...del]) {
      expect(out).not.toContain(j.id);
      if (j.idempotency_key) expect(out).not.toContain(j.idempotency_key);
    }
  });
});

describe('executeRetention — refus du mode réel', () => {
  it('pendant le gel : refusé même avec toutes les confirmations', async () => {
    seedMixed();
    const plan = await planRetention(fake as never, FROZEN);
    const r = await executeRetention(
      [...APPLY_OK, `--confirm=${plan.plannedDeletes}`],
      fake as never,
      FROZEN
    );
    expect(r.exitCode).toBe(2);
    expect(JSON.stringify(r.output)).toContain(FREEZE_UNTIL);
    expect(fake.writes).toHaveLength(0);
  });

  it('sans --backup-confirmed, ou --confirm différent du plan : refusé', async () => {
    seedMixed();
    for (const argv of [['--apply', '--confirm=4'], [...APPLY_OK, '--confirm=5'], [...APPLY_OK]]) {
      const r = await executeRetention(argv, fake as never, NOW);
      expect(r.exitCode).toBe(2);
    }
    expect(fake.writes).toHaveLength(0);
  });

  it('argument inconnu : arrêt (une faute de frappe ne devient pas un mode)', async () => {
    const r = await executeRetention(['--aply'], fake as never, NOW);
    expect(r.exitCode).toBe(1);
  });

  it('privilège DELETE absent (réalité 002b) : arrêt propre, rien supprimé', async () => {
    seedMixed();
    const before = ids();
    fake.failNext('autotim', 'jobs', 'delete', { code: '42501', message: 'permission denied' });
    const r = await executeRetention([...APPLY_OK, '--confirm=4'], fake as never, NOW);
    expect(r.exitCode).toBe(2);
    expect(JSON.stringify(r.output)).toContain('privilège DELETE');
    expect(ids()).toEqual(before);
  });
});

describe('executeRetention — application (après le gel, simulée)', () => {
  it('supprime exactement le plan ; actifs, envois, campagnes et DLQ récente intacts', async () => {
    const { keep, del } = seedMixed();
    const r = await executeRetention([...APPLY_OK, '--confirm=4'], fake as never, NOW);
    expect(r.exitCode).toBe(0);
    expect(r.output.consistent).toBe(true);
    const left = ids();
    for (const j of keep) expect(left.has(j.id)).toBe(true);
    for (const j of del) expect(left.has(j.id)).toBe(false);
  });

  it('idempotent : un second passage ne trouve rien et ne supprime rien', async () => {
    seedMixed();
    await executeRetention([...APPLY_OK, '--confirm=4'], fake as never, NOW);
    const after = ids();
    const r = await executeRetention([...APPLY_OK, '--confirm=0'], fake as never, NOW);
    expect(r.exitCode).toBe(0);
    expect(ids()).toEqual(after);
  });

  it('un job redevenu actif ou rajeuni entre plan et suppression est épargné', async () => {
    const a = job({ daysAgo: 20 });
    const b = job({ daysAgo: 20 });
    fake.seed('autotim', 'jobs', [row(a), row(b)]);
    const plan = await planRetention(fake as never, NOW);
    expect(plan.plannedDeletes).toBe(2);

    // Entre-temps : a est ré-enfilé, b vient d'être mis à jour. (`all` copie le
    // tableau, pas les lignes : la modification porte sur la base en mémoire.)
    const store = fake.all('autotim', 'jobs');
    Object.assign(store.find((r) => r.id === a.id)!, { status: 'pending' });
    Object.assign(store.find((r) => r.id === b.id)!, { updated_at: iso(NOW) });

    const res = await applyRetention(fake as never, plan, NOW);
    expect(res.deleted.sync_done_expired).toBe(0);
    expect(ids()).toEqual(new Set([a.id, b.id]));
  });

  it('pagination : 2 500 syncs expirés tous planifiés (au-delà de 1 000 lignes)', async () => {
    fake.seed(
      'autotim',
      'jobs',
      Array.from({ length: 2500 }, () => row(job({ daysAgo: 30 })))
    );
    const plan = await planRetention(fake as never, NOW);
    expect(plan.scanned).toBe(2500);
    expect(plan.plannedDeletes).toBe(2500);
  });
});

describe('idempotence préservée après nettoyage', () => {
  it('une notification déjà envoyée ne peut pas être ré-enfilée', async () => {
    seedMixed();
    await executeRetention([...APPLY_OK, '--confirm=4'], fake as never, NOW);
    const again = await enqueue(fake as never, {
      tenantId: T1,
      type: 'whatsapp.send',
      payload: { phone: '213555000000', message: 'synthétique' },
      idempotencyKey: notificationKey(T1, 'TRK1', 'livre'),
    });
    expect(again).toBeNull();
    const camp = await enqueue(fake as never, {
      tenantId: T1,
      type: 'whatsapp.send',
      payload: { phone: '213555000001', message: 'synthétique' },
      idempotencyKey: campaignRecipientKey('c1', '213555000001'),
    });
    expect(camp).toBeNull();
  });

  it('les clés sync supprimées appartiennent à des créneaux que syncKey ne produit plus', async () => {
    const { del } = seedMixed();
    await executeRetention([...APPLY_OK, '--confirm=4'], fake as never, NOW);
    const current = new Set([syncKey(T1, NOW), syncKey(T2, NOW)]);
    for (const j of del) expect(current.has(j.idempotency_key ?? '')).toBe(false);
  });

  it('les seuils de la politique sont ceux documentés', () => {
    expect(RETENTION_POLICY).toEqual({ syncDoneDays: 14, syncDeadDays: 90, testResidueDays: 1 });
  });
});

describe('db/proposed/006_jobs_retention.sql — aligné sur la politique', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../db/proposed/006_jobs_retention.sql'),
    'utf8'
  );
  const active = sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  // Le bloc DELETE seul : l'aperçu (section 1) cite aussi 14 et 90 jours.
  const del = active.slice(active.indexOf('DELETE FROM'), active.indexOf('RETURNING'));

  it('mêmes seuils, même tenant de test, même créneau que le code', () => {
    expect(del).toContain(
      `j.status = 'done' AND j.updated_at < now() - interval '${RETENTION_POLICY.syncDoneDays} days'`
    );
    expect(del).toContain(
      `j.status = 'dead' AND j.updated_at < now() - interval '${RETENTION_POLICY.syncDeadDays} days'`
    );
    expect(del).toContain(`interval '${RETENTION_POLICY.testResidueDays} day'`);
    expect(del).toContain(`'${TEST_TENANT_ID}'`);
    expect(active).toContain(`/ ${SYNC_SLOT_SECONDS})`);
  });

  it('ne supprime que zrexpress.sync (hors résidus de test), jamais whatsapp.send ni campagne', () => {
    expect(del).toContain("j.status IN ('done', 'dead')");
    expect(del).toContain("j.type = 'zrexpress.sync'");
    expect(del).not.toMatch(/whatsapp\.send|campaign\.dispatch/);
  });

  it('ROLLBACK par défaut ; aucun COMMIT, GRANT ni DROP actif', () => {
    expect(active).toMatch(/^ROLLBACK;/m);
    expect(active).not.toMatch(/^\s*COMMIT\b/im);
    // `ON COMMIT DROP` (table temporaire du créneau) est attendu ; pas un DROP d'objet.
    expect(active).not.toMatch(/\bGRANT\b|\bDROP\s+(TABLE|SCHEMA|INDEX)\b|\bTRUNCATE\b/i);
  });
});
