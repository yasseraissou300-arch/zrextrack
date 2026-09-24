// P2-8 — Rétention de autotim.jobs.
//
// ⚠️  PRÉPARÉ, JAMAIS EXÉCUTÉ. Refus intégré pendant le gel (jusqu'au
//     2026-09-26T22:15Z). De plus, service_role n'a PAS le privilège DELETE sur
//     autotim (002b, moindre privilège) : l'application réelle exige d'abord une
//     décision post-gel (GRANT DELETE, ou exécution par `postgres` du SQL de
//     db/proposed/006_jobs_retention.sql, qui reprend exactement ces règles).
//
// POURQUOI SI PEU DE LIGNES SONT SUPPRIMABLES
// La clé d'idempotence n'existe QUE dans la ligne du job (index unique
// jobs_idempotency_uniq). Supprimer un job, c'est supprimer sa protection
// anti-doublon :
//   - whatsapp.send  `notif:<tenant>:<tracking>:<statut>` : si la mise à jour de
//     pending_notifications a échoué, ou si le verrou est mort après l'envoi,
//     la notification reste « pending » et SEULE cette clé empêche un second
//     envoi au client. `camp:<campagne>:<téléphone>` : seule barrière contre un
//     second message au même destinataire.
//   - campaign.dispatch `campdisp:<campagne>:<offset>` : empêche de ré-enfiler
//     un lot déjà servi.
//   → Ces jobs ne sont JAMAIS supprimés par cette politique, DLQ comprise.
//   - zrexpress.sync `sync:<tenant>:<créneau 5 min>` : un créneau passé n'est
//     jamais recalculé (syncKey utilise l'heure courante). Supprimer un sync
//     terminé depuis longtemps ne rouvre aucune porte. C'est aussi le seul type
//     à fort volume (288 jobs/jour/tenant en mode serveur).
//
// Jamais supprimés quel que soit l'âge : pending, running (même verrou mort —
// recoverStaleLocks s'en charge), failed, statut ou type inconnu.

import { syncSlot } from './idempotency';
import { QUEUE_SCHEMA, type Job } from './types';

export const RETENTION_POLICY = {
  /** Sync terminé : conservé 14 jours (diagnostic des incidents récents). */
  syncDoneDays: 14,
  /** Sync en DLQ : conservé 90 jours (audit). */
  syncDeadDays: 90,
  /** Résidus du test d'intégration réel (tenant réservé, payload __test__). */
  testResidueDays: 1,
} as const;

/** Tenant réservé de tests/integration/autotim-real.test.ts (absent de auth). */
export const TEST_TENANT_ID = '00000000-0000-4000-8000-000000000001';

/** Fin du gel de la fenêtre 72 h v2 : aucune suppression réelle avant. */
export const FREEZE_UNTIL = '2026-09-26T22:15:00Z';

const PAGE = 1000; // = db-max-rows de PostgREST
const DELETE_CHUNK = 200;
const DAY_MS = 86_400_000;

export type KeepReason =
  | 'active'
  | 'unknown_status'
  | 'unknown_type'
  | 'idempotency_guard'
  | 'key_not_expired'
  | 'too_recent'
  | 'dlq_retained'
  | 'invalid_date';
export type DeleteReason = 'sync_done_expired' | 'sync_dead_expired' | 'test_residue';

export type RetentionDecision =
  | { action: 'keep'; reason: KeepReason }
  | { action: 'delete'; reason: DeleteReason };

export type RetentionJob = Pick<
  Job,
  'id' | 'tenant_id' | 'type' | 'status' | 'updated_at' | 'idempotency_key'
> & { payload?: Record<string, unknown> | null };

const ACTIVE = new Set(['pending', 'running', 'failed']);
const TERMINAL = new Set(['done', 'dead']);

/** Le créneau de la clé sync est-il révolu (et la clé bien celle du tenant) ? */
function syncKeyExpired(job: RetentionJob, now: Date): boolean {
  if (job.idempotency_key == null) return true;
  const m = /^sync:([^:]+):(\d+)$/.exec(job.idempotency_key);
  if (!m || m[1] !== job.tenant_id) return false;
  // Marge d'un créneau : le créneau courant ET le précédent restent protégés.
  return Number(m[2]) < syncSlot(now) - 1;
}

/** Décision pour UN job. Pure : aucune E/S. */
export function classifyJob(
  job: RetentionJob,
  now: Date,
  policy: typeof RETENTION_POLICY = RETENTION_POLICY
): RetentionDecision {
  if (ACTIVE.has(job.status)) return { action: 'keep', reason: 'active' };
  if (!TERMINAL.has(job.status)) return { action: 'keep', reason: 'unknown_status' };

  const updated = Date.parse(job.updated_at);
  if (Number.isNaN(updated)) return { action: 'keep', reason: 'invalid_date' };
  const ageDays = (now.getTime() - updated) / DAY_MS;

  if (job.tenant_id === TEST_TENANT_ID && job.payload?.__test__ === true) {
    return ageDays > policy.testResidueDays
      ? { action: 'delete', reason: 'test_residue' }
      : { action: 'keep', reason: 'too_recent' };
  }

  if (job.type === 'whatsapp.send' || job.type === 'campaign.dispatch') {
    return { action: 'keep', reason: 'idempotency_guard' };
  }
  if (job.type !== 'zrexpress.sync') return { action: 'keep', reason: 'unknown_type' };

  if (!syncKeyExpired(job, now)) return { action: 'keep', reason: 'key_not_expired' };
  if (job.status === 'done') {
    return ageDays > policy.syncDoneDays
      ? { action: 'delete', reason: 'sync_done_expired' }
      : { action: 'keep', reason: 'too_recent' };
  }
  return ageDays > policy.syncDeadDays
    ? { action: 'delete', reason: 'sync_dead_expired' }
    : { action: 'keep', reason: 'dlq_retained' };
}

// ─── Plan (lecture seule) ────────────────────────────────────────────────────

export interface RetentionPlan {
  scanned: number;
  /** `<type>|<statut>|<keep|delete>:<raison>` → nombre. Comptes uniquement. */
  buckets: Record<string, number>;
  toDelete: Record<DeleteReason, number>;
  plannedDeletes: number;
  /** Ids à supprimer, par raison. Usage interne : jamais imprimés. */
  ids: Record<DeleteReason, string[]>;
  error?: string;
}

type Supa = {
  schema: (s: string) => { from: (t: string) => any };
};

const SCAN_COLUMNS = 'id,tenant_id,type,status,updated_at,idempotency_key';

/** Parcourt autotim.jobs par id croissant (pagination par clé, pas d'offset). */
export async function planRetention(
  supabase: Supa,
  now: Date,
  policy: typeof RETENTION_POLICY = RETENTION_POLICY
): Promise<RetentionPlan> {
  const plan: RetentionPlan = {
    scanned: 0,
    buckets: {},
    toDelete: { sync_done_expired: 0, sync_dead_expired: 0, test_residue: 0 },
    plannedDeletes: 0,
    ids: { sync_done_expired: [], sync_dead_expired: [], test_residue: [] },
  };
  const jobs = () => supabase.schema(QUEUE_SCHEMA).from('jobs');

  let lastId: string | null = null;
  for (;;) {
    let q = jobs().select(SCAN_COLUMNS).order('id', { ascending: true }).limit(PAGE);
    if (lastId) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) return { ...plan, error: `lecture jobs (${error.code ?? 'inconnue'})` };
    const rows = (data ?? []) as RetentionJob[];
    if (rows.length === 0) break;

    // Le payload n'est lu QUE pour le tenant de test (il peut contenir un
    // téléphone et un message pour les autres).
    const testIds = rows.filter((r) => r.tenant_id === TEST_TENANT_ID).map((r) => r.id);
    const payloads = new Map<string, Record<string, unknown> | null>();
    if (testIds.length) {
      const { data: p, error: pErr } = await jobs()
        .select('id,payload')
        .eq('tenant_id', TEST_TENANT_ID)
        .in('id', testIds);
      if (pErr) return { ...plan, error: `lecture payload test (${pErr.code ?? 'inconnue'})` };
      for (const r of (p ?? []) as Array<{ id: string; payload: Record<string, unknown> | null }>)
        payloads.set(r.id, r.payload);
    }

    for (const row of rows) {
      const job = { ...row, payload: payloads.get(row.id) ?? null };
      const d = classifyJob(job, now, policy);
      const bucket = `${job.type}|${job.status}|${d.action}:${d.reason}`;
      plan.buckets[bucket] = (plan.buckets[bucket] ?? 0) + 1;
      if (d.action === 'delete') {
        plan.toDelete[d.reason]++;
        plan.ids[d.reason].push(job.id);
        plan.plannedDeletes++;
      }
    }
    plan.scanned += rows.length;
    lastId = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }
  return plan;
}

// ─── Application (jamais pendant le gel) ─────────────────────────────────────

export interface ApplyResult {
  deleted: Record<DeleteReason, number>;
  /** Code PostgreSQL si la suppression a été refusée (42501 = pas de DELETE). */
  error?: string;
}

/**
 * Supprime les ids du plan. Chaque DELETE RÉAFFIRME la politique côté base
 * (type, statut terminal, âge, tenant) : un job redevenu actif ou rajeuni
 * depuis le plan n'est pas touché, même si son id figure dans la liste.
 */
export async function applyRetention(
  supabase: Supa,
  plan: RetentionPlan,
  now: Date,
  policy: typeof RETENTION_POLICY = RETENTION_POLICY
): Promise<ApplyResult> {
  const deleted: Record<DeleteReason, number> = {
    sync_done_expired: 0,
    sync_dead_expired: 0,
    test_residue: 0,
  };
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();

  const scoped: Record<DeleteReason, (q: any) => any> = {
    sync_done_expired: (q) =>
      q
        .eq('type', 'zrexpress.sync')
        .eq('status', 'done')
        .lt('updated_at', cutoff(policy.syncDoneDays)),
    sync_dead_expired: (q) =>
      q
        .eq('type', 'zrexpress.sync')
        .eq('status', 'dead')
        .lt('updated_at', cutoff(policy.syncDeadDays)),
    test_residue: (q) =>
      q
        .eq('tenant_id', TEST_TENANT_ID)
        .in('status', ['done', 'dead'])
        .lt('updated_at', cutoff(policy.testResidueDays)),
  };

  for (const reason of Object.keys(scoped) as DeleteReason[]) {
    const ids = plan.ids[reason];
    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK);
      const q = supabase.schema(QUEUE_SCHEMA).from('jobs').delete().in('id', chunk);
      const { data, error } = await scoped[reason](q).select('id');
      if (error) return { deleted, error: error.code ?? 'inconnue' };
      deleted[reason] += (data ?? []).length;
    }
  }
  return { deleted };
}

// ─── Commande (utilisée par scripts/jobs-retention.ts) ───────────────────────

export interface RetentionArgs {
  apply: boolean;
  backupConfirmed: boolean;
  confirm: number | null;
}

export function parseRetentionArgs(argv: string[]): RetentionArgs | { error: string } {
  const known = /^--(apply|backup-confirmed|confirm=\d+|target=.*)$/;
  const unknown = argv.filter((a) => !known.test(a));
  if (unknown.length) return { error: `arguments inconnus : ${unknown.join(' ')}` };
  const c = argv.find((a) => a.startsWith('--confirm='));
  return {
    apply: argv.includes('--apply'),
    backupConfirmed: argv.includes('--backup-confirmed'),
    confirm: c ? Number(c.slice('--confirm='.length)) : null,
  };
}

/** Raisons pour lesquelles le mode réel est refusé. Vide = autorisé. */
export function retentionBlockers(args: RetentionArgs, plan: RetentionPlan, now: Date): string[] {
  const b: string[] = [];
  if (now.getTime() < Date.parse(FREEZE_UNTIL))
    b.push(`gel production actif jusqu'à ${FREEZE_UNTIL}`);
  if (plan.error) b.push(`plan incomplet : ${plan.error}`);
  if (!args.backupConfirmed) b.push('--backup-confirmed requis (sauvegarde de autotim.jobs faite)');
  if (args.confirm !== plan.plannedDeletes) {
    b.push(`--confirm=${plan.plannedDeletes} requis (nombre de suppressions de la simulation)`);
  }
  return b;
}

type PublicPlan = Omit<RetentionPlan, 'ids'>;
const publicPlan = ({ ids: _ids, ...rest }: RetentionPlan): PublicPlan => rest;

export async function executeRetention(
  argv: string[],
  supabase: Supa,
  now: Date = new Date()
): Promise<{ exitCode: 0 | 1 | 2 | 3; output: Record<string, unknown> }> {
  const args = parseRetentionArgs(argv);
  if ('error' in args) return { exitCode: 1, output: { error: args.error } };

  const plan = await planRetention(supabase, now);
  if (!args.apply) {
    return {
      exitCode: plan.error ? 1 : 0,
      output: { mode: 'simulation', policy: RETENTION_POLICY, plan: publicPlan(plan) },
    };
  }

  const blockers = retentionBlockers(args, plan, now);
  if (blockers.length) {
    return { exitCode: 2, output: { mode: 'refusé', blockers, plan: publicPlan(plan) } };
  }

  const applied = await applyRetention(supabase, plan, now);
  if (applied.error) {
    return {
      exitCode: 2,
      output: {
        mode: 'interrompu',
        error:
          applied.error === '42501'
            ? 'service_role sans privilège DELETE sur autotim.jobs (002b) : décision post-gel requise'
            : `suppression refusée (${applied.error})`,
        applied,
      },
    };
  }

  // Vérification : un second plan ne doit plus rien trouver à supprimer.
  const verification = await planRetention(supabase, now);
  const consistent = !verification.error && verification.plannedDeletes === 0;
  return {
    exitCode: consistent ? 0 : 3,
    output: { mode: 'appliqué', applied, verification: publicPlan(verification), consistent },
  };
}
