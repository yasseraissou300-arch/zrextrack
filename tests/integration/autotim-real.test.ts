// Phase 1 — Test APPLICATIF RÉEL du chemin :
//     createServiceClient() → .schema('autotim') → autotim.jobs
//
// Utilise EXACTEMENT le même client et le même repository que le code de
// production (src/lib/supabase/server.ts, src/lib/queue/repository.ts).
// Aucun mock. Aucun handler exécuté : donc aucun envoi WhatsApp, aucun appel
// ZRExpress, aucune campagne. Aucune écriture dans `public`.
//
// Isolation :
//   - tenant_id de test  : TEST_TENANT (UUID réservé, n'existe pas dans auth)
//   - payload marqué     : { __test__: true, run_id }
//   - clés d'idempotence : test:real:<run_id>:*
//   - run_after passé/futur choisi pour que seul CE test puisse les réclamer
//
// Nettoyage : service_role n'a PAS le privilège DELETE (moindre privilège,
// 002b). Les lignes de test sont laissées en état TERMINAL (done / dead) —
// un tick ne peut jamais les réclamer — et leurs ids sont imprimés en fin de
// test pour suppression manuelle par `postgres` dans le SQL Editor :
//   DELETE FROM autotim.jobs WHERE tenant_id = '<TEST_TENANT>' AND payload->>'__test__' = 'true';
//   DELETE FROM autotim.tenant_settings WHERE tenant_id = '<TEST_TENANT>';
//
// Lancer : npm run test:integration   (jamais inclus dans `npm test`)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// ── Chargement de .env.local (sans dépendance dotenv) ────────────────────────
function loadEnvLocal() {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, v0] = m;
      const v = v0.replace(/^["']|["']$/g, '');
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* pas de .env.local : on s'appuie sur l'environnement */
  }
}
loadEnvLocal();

const HAS_KEY = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// Importés après le chargement de l'env (createServiceClient lit process.env à l'appel).
import { createServiceClient } from '@/lib/supabase/server';
import {
  enqueue,
  claimJobs,
  markDone,
  markFailed,
  markRescheduled,
  recoverStaleLocks,
  getTenantSettings,
  upsertTenantSettings,
  listServerSyncTenants,
  STALE_LOCK_MINUTES,
} from '@/lib/queue/repository';
import { QUEUE_SCHEMA, MAX_ATTEMPTS, type Job } from '@/lib/queue/types';

const TEST_TENANT = '00000000-0000-4000-8000-000000000001';
const RUN_ID = randomUUID().slice(0, 8);
const KEY = (suffix: string) => `test:real:${RUN_ID}:${suffix}`;
const TEST_PAYLOAD = {
  __test__: true,
  run_id: RUN_ID,
  note: 'TEST Phase 1 — aucune donnée métier',
};

const describeReal = HAS_KEY ? describe : describe.skip;

if (!HAS_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n[integration] IGNORÉ — SUPABASE_SERVICE_ROLE_KEY et/ou NEXT_PUBLIC_SUPABASE_URL absents de .env.local\n'
  );
}

describeReal("Chemin réel createServiceClient() → .schema('autotim')", () => {
  // Créé dans beforeAll : describe.skip évalue quand même ce corps, et
  // createServiceClient() lève sans clé.
  let supabase: ReturnType<typeof createServiceClient>;
  const jobs = () => supabase.schema(QUEUE_SCHEMA).from('jobs');
  const createdIds: string[] = [];

  beforeAll(async () => {
    supabase = createServiceClient();
    // GARDE-FOU : le claim réclame N'IMPORTE QUEL job dû. On refuse de tourner
    // s'il existe des jobs réels en attente — on ne touche jamais au travail
    // d'un vrai tenant.
    const { data, error } = await jobs()
      .select('id, tenant_id, type')
      .eq('status', 'pending')
      .lte('run_after', new Date().toISOString())
      .neq('tenant_id', TEST_TENANT);
    expect(error).toBeNull();
    if (data && data.length > 0) {
      throw new Error(
        `ABANDON : ${data.length} job(s) réel(s) en attente dans autotim.jobs — ce test ne doit pas les réclamer.`
      );
    }
  });

  afterAll(async () => {
    // Tout ce que le test a créé doit être en état terminal.
    if (createdIds.length === 0) return;
    const { data } = await jobs().select('id, status').in('id', createdIds);
    const nonTerminal = (data ?? []).filter((j: any) => !['done', 'dead'].includes(j.status));
    // eslint-disable-next-line no-console
    console.log(
      `\n[integration] run_id=${RUN_ID} tenant=${TEST_TENANT}\n` +
        `[integration] jobs de test créés (à supprimer par postgres) : ${createdIds.join(', ')}\n` +
        `[integration] non terminaux : ${nonTerminal.length}\n`
    );
    expect(nonTerminal).toHaveLength(0);
  });

  it('1. le client service_role accède au schéma autotim (exposition + GRANT 002b)', async () => {
    const { error, count } = await jobs().select('id', { count: 'exact', head: true });
    expect(error).toBeNull();
    expect(typeof count).toBe('number');

    const ts = await supabase
      .schema(QUEUE_SCHEMA)
      .from('tenant_settings')
      .select('tenant_id', { count: 'exact', head: true });
    expect(ts.error).toBeNull();
  });

  let job: Job;

  it('2. INSERT via enqueue() — job de test isolé', async () => {
    const created = await enqueue(supabase, {
      tenantId: TEST_TENANT,
      type: 'zrexpress.sync',
      payload: TEST_PAYLOAD,
      runAfter: new Date(Date.now() - 1000),
      idempotencyKey: KEY('main'),
    });
    expect(created).not.toBeNull();
    job = created!;
    createdIds.push(job.id);

    expect(job).toMatchObject({
      tenant_id: TEST_TENANT,
      type: 'zrexpress.sync',
      status: 'pending',
      attempts: 0,
      max_attempts: MAX_ATTEMPTS['zrexpress.sync'],
      locked_at: null,
      locked_by: null,
      idempotency_key: KEY('main'),
    });
    expect(job.payload).toMatchObject({ __test__: true, run_id: RUN_ID });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/); // gen_random_uuid() côté base
  });

  it('3. SELECT direct .schema(autotim).from(jobs)', async () => {
    const { data, error } = await jobs().select('*').eq('id', job.id).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: job.id, tenant_id: TEST_TENANT, status: 'pending' });
  });

  it('4. idempotence — même clé → null, une seule ligne en base', async () => {
    const dup = await enqueue(supabase, {
      tenantId: TEST_TENANT,
      type: 'zrexpress.sync',
      payload: { ...TEST_PAYLOAD, doublon: true },
      idempotencyKey: KEY('main'),
    });
    expect(dup).toBeNull();

    const { count } = await jobs()
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', KEY('main'));
    expect(count).toBe(1);

    // La ligne d'origine n'a pas été modifiée par la tentative de doublon.
    const { data } = await jobs().select('payload').eq('id', job.id).single();
    expect((data as any).payload.doublon).toBeUndefined();
  });

  it('5. claim compare-and-swap — pris une fois, plus jamais par un autre worker', async () => {
    const claimed = await claimJobs(supabase, 5, `test-${RUN_ID}-w1`);
    const mine = claimed.find((j) => j.id === job.id);
    expect(mine).toBeDefined();
    expect(claimed.every((j) => j.tenant_id === TEST_TENANT)).toBe(true); // garde-fou
    expect(mine).toMatchObject({ status: 'running', attempts: 1, locked_by: `test-${RUN_ID}-w1` });
    expect(mine!.locked_at).not.toBeNull();

    const again = await claimJobs(supabase, 5, `test-${RUN_ID}-w2`);
    expect(again.find((j) => j.id === job.id)).toBeUndefined();
    job = mine!;
  });

  it('6. reschedule — revient pending SANS consommer de tentative', async () => {
    await markRescheduled(supabase, job, new Date(Date.now() + 3600_000), 'test reschedule');
    const { data } = await jobs().select('*').eq('id', job.id).single();
    expect(data).toMatchObject({
      status: 'pending',
      attempts: 0,
      locked_at: null,
      locked_by: null,
      last_error: 'test reschedule',
    });
    // Dans le futur → non réclamable.
    const claimed = await claimJobs(supabase, 5, `test-${RUN_ID}-w3`);
    expect(claimed.find((j) => j.id === job.id)).toBeUndefined();
  });

  it('7. UPDATE run_after (service_role a UPDATE) puis re-claim → attempts 1', async () => {
    const { error } = await jobs()
      .update({ run_after: new Date(Date.now() - 1000).toISOString() })
      .eq('id', job.id)
      .eq('tenant_id', TEST_TENANT);
    expect(error).toBeNull();
    const [c] = (await claimJobs(supabase, 5, `test-${RUN_ID}-w4`)).filter((j) => j.id === job.id);
    expect(c).toMatchObject({ status: 'running', attempts: 1 });
    job = c;
  });

  it('8. les contraintes CHECK de la base sont actives (jobs_locked_coherence_chk)', async () => {
    const { error } = await jobs().update({ status: 'running', locked_at: null }).eq('id', job.id);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
    expect(error!.message).toContain('jobs_locked_coherence_chk');
  });

  it('9. UPDATE vers done via markDone()', async () => {
    await markDone(supabase, job.id);
    const { data } = await jobs().select('*').eq('id', job.id).single();
    expect(data).toMatchObject({ status: 'done', locked_at: null, locked_by: null, attempts: 1 });
  });

  it('10. stale lock réel : running depuis > 5 min → repris, puis DLQ pour un whatsapp.send', async () => {
    const stale = await enqueue(supabase, {
      tenantId: TEST_TENANT,
      type: 'whatsapp.send',
      payload: { ...TEST_PAYLOAD, phone: '0000000000', message: 'TEST — jamais envoyé' },
      runAfter: new Date(Date.now() - 1000),
      idempotencyKey: KEY('stale'),
    });
    expect(stale).not.toBeNull();
    createdIds.push(stale!.id);
    expect(stale!.max_attempts).toBe(1);

    const [c] = (await claimJobs(supabase, 5, `test-${RUN_ID}-mort`)).filter(
      (j) => j.id === stale!.id
    );
    expect(c.status).toBe('running');

    // Simule un worker tué il y a 6 min.
    const { error } = await jobs()
      .update({ locked_at: new Date(Date.now() - (STALE_LOCK_MINUTES + 1) * 60_000).toISOString() })
      .eq('id', stale!.id);
    expect(error).toBeNull();

    const recovered = await recoverStaleLocks(supabase);
    expect(recovered).toBeGreaterThanOrEqual(1);
    const { data: after } = await jobs()
      .select('status, locked_at, attempts')
      .eq('id', stale!.id)
      .single();
    expect(after).toMatchObject({ status: 'pending', locked_at: null, attempts: 1 });

    // Re-claim : attempts passe à 2 (= max_attempts + 1, autorisé par jobs_attempts_chk)
    const [c2] = (await claimJobs(supabase, 5, `test-${RUN_ID}-w5`)).filter(
      (j) => j.id === stale!.id
    );
    expect(c2.attempts).toBe(2);
    // Le runner ne rejoue jamais (voir runner.ts) : DLQ.
    expect(await markFailed(supabase, c2, 'TEST — tentatives épuisées après reprise')).toBe('dead');
    const { data: dead } = await jobs().select('status').eq('id', stale!.id).single();
    expect(dead).toMatchObject({ status: 'dead' });
  });

  it('11. tenant_settings : upsert/lecture, et le tenant de test n’est PAS planifiable', async () => {
    await upsertTenantSettings(supabase, TEST_TENANT, {
      sync_source: 'client',
      auto_sync_enabled: false,
    });
    const ts = await getTenantSettings(supabase, TEST_TENANT);
    expect(ts).toMatchObject({
      tenant_id: TEST_TENANT,
      sync_source: 'client',
      auto_sync_enabled: false,
      consecutive_send_failures: 0,
    });
    const planifiables = await listServerSyncTenants(supabase);
    expect(planifiables.find((t) => t.tenant_id === TEST_TENANT)).toBeUndefined();
  });

  it('12. service_role ne peut PAS supprimer (moindre privilège 002b)', async () => {
    const { error } = await jobs().delete().eq('id', job.id);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});
