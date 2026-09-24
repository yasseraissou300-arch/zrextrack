// Accès à la file — toutes les écritures dans `autotim` passent par ici.
//
// PRÉREQUIS : le schéma `autotim` doit être ajouté aux « Exposed schemas »
// (Supabase → Settings → API). Sans cela, `.schema('autotim')` échoue en
// PGRST106. L'exposition reste sûre : `REVOKE ALL ON SCHEMA autotim FROM
// anon, authenticated` + RLS activée sans policy ⇒ seul service_role accède.

import { createServiceClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/security/safe-log';
import { nextRunAfter } from './backoff';
import {
  QUEUE_SCHEMA,
  MAX_ATTEMPTS,
  type Job,
  type JobType,
  type TenantSettings,
  type SyncSource,
} from './types';

/** Au-delà, un job « running » est considéré orphelin (10× le budget du tick). */
export const STALE_LOCK_MINUTES = 5;

type Client = ReturnType<typeof createServiceClient>;

function q(supabase: Client) {
  return supabase.schema(QUEUE_SCHEMA);
}

// ── Reprise unique sur 5xx de la passerelle Supabase ────────────────────────
//
// Mesure 2026-09-13 : ~7 % des ticks en HTTP 500 parce qu'UNE requête
// PostgREST recevait 504 « Gateway Timeout » de la passerelle Supabase après
// ~5 s, alors que le SQL s'exécute en ≤ 2 ms. La requête suivante réussissait
// toujours. postgrest-js ne réessaie que 503/520, pas 504.
//
// Portée volontairement étroite : uniquement les trois requêtes IDEMPOTENTES
// du début de tick (reprise des verrous, liste des tenants, sélection des
// candidats). Une seule reprise, puis l'erreur remonte comme avant (tick 500).
// Chaque reprise est journalisée : un 504 n'est jamais rendu invisible.
export const GATEWAY_RETRY_DELAY_MS = 1_000;

type PgResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
  status?: number;
};

function isGatewayFailure(r: PgResult<unknown>): boolean {
  if (!r.error) return false;
  if (r.status === 502 || r.status === 503 || r.status === 504) return true;
  return /gateway time-?out|bad gateway/i.test(r.error.message ?? '');
}

async function withGatewayRetry<T>(
  op: string,
  run: () => PromiseLike<PgResult<T>>
): Promise<PgResult<T>> {
  const first = await run();
  if (!isGatewayFailure(first)) return first;
  logEvent('warn', 'queue.gateway', {
    status: 'retry',
    event: op,
    error_code: first.status ? String(first.status) : first.error?.code,
  });
  await new Promise((r) => setTimeout(r, GATEWAY_RETRY_DELAY_MS));
  const second = await run();
  logEvent(second.error ? 'error' : 'info', 'queue.gateway', {
    status: second.error ? 'retry_failed' : 'retry_ok',
    event: op,
  });
  return second;
}

// ── Enfilement ──────────────────────────────────────────────────────────────

export interface EnqueueInput {
  tenantId: string;
  type: JobType;
  payload?: Record<string, unknown>;
  runAfter?: Date;
  idempotencyKey?: string;
  maxAttempts?: number;
}

/**
 * Enfile un job. Si `idempotencyKey` existe déjà, l'insertion est ignorée
 * silencieusement — enfiler deux fois est un no-op, jamais une erreur.
 *
 * Renvoie le job créé, ou null si dédupliqué.
 */
export async function enqueue(supabase: Client, input: EnqueueInput): Promise<Job | null> {
  const row = {
    tenant_id: input.tenantId,
    type: input.type,
    payload: input.payload ?? {},
    status: 'pending' as const,
    run_after: (input.runAfter ?? new Date()).toISOString(),
    max_attempts: input.maxAttempts ?? MAX_ATTEMPTS[input.type],
    idempotency_key: input.idempotencyKey ?? null,
  };

  const { data, error } = await q(supabase)
    .from('jobs')
    .upsert(row, { onConflict: 'idempotency_key', ignoreDuplicates: true })
    .select()
    .maybeSingle();

  if (error) {
    logEvent('error', 'queue.enqueue', {
      tenant_id: input.tenantId,
      event: input.type,
      status: 'error',
      error_code: error.code,
    });
    throw new Error(`enqueue ${input.type}: ${error.message}`);
  }
  return (data as Job | null) ?? null;
}

// ── Réclamation ─────────────────────────────────────────────────────────────

/**
 * Réclame jusqu'à `limit` jobs dus, par compare-and-swap.
 *
 * POURQUOI PAS `FOR UPDATE SKIP LOCKED` : PostgREST ne sait pas l'exprimer, et
 * l'introduire exigerait une fonction PL/pgSQL — un objet de base qui ne
 * figurait pas dans la migration validée.
 *
 * Le compare-and-swap donne la MÊME garantie d'exclusivité : l'UPDATE
 * conditionné par `status = 'pending'` est atomique. Si un autre worker a déjà
 * pris le job, l'UPDATE touche 0 ligne et on passe au suivant. Aucun job ne
 * peut être attribué deux fois.
 *
 * Coût : un aller-retour par job au lieu d'un seul pour le lot. À 4 tenants et
 * quelques jobs par tick, c'est négligeable. Si le volume l'exigeait un jour,
 * une fonction SQL avec SKIP LOCKED remplacerait cette boucle sans changer
 * l'interface.
 */
export async function claimJobs(supabase: Client, limit: number, workerId: string): Promise<Job[]> {
  const nowIso = new Date().toISOString();

  // 1) Candidats : les jobs dus, les plus anciens d'abord.
  //    On en demande plus que `limit` pour absorber la concurrence.
  const { data: candidates, error: selErr } = await withGatewayRetry('claim.select', () =>
    q(supabase)
      .from('jobs')
      .select('id, attempts')
      .eq('status', 'pending')
      .lte('run_after', nowIso)
      .order('run_after', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(limit * 2)
  );

  if (selErr) {
    logEvent('error', 'queue.claim', { status: 'error', error_code: selErr.code });
    throw new Error(`claim (select): ${selErr.message}`);
  }
  if (!candidates?.length) return [];

  // 2) Prise atomique, un par un — statut ET compteur dans le MÊME UPDATE.
  //
  // Avant : prise (status → running) puis second UPDATE pour `attempts`,
  // dont l'erreur était ignorée. Si ce second UPDATE échouait (504 passerelle,
  // mesuré sur ~7 % des ticks) et que la fonction mourait après l'envoi, la
  // reprise du verrou mort relançait le job avec attempts = 0 → 1 ≤ max 1 :
  // un whatsapp.send était REJOUÉ, en violation de max_attempts = 1.
  // Condition `attempts = <lu>` : la valeur écrite dérive de celle lue, sans
  // fenêtre entre les deux.
  const claimed: Job[] = [];
  for (const c of candidates as Array<{ id: string; attempts: number }>) {
    if (claimed.length >= limit) break;

    const { data, error } = await q(supabase)
      .from('jobs')
      .update({
        status: 'running',
        attempts: c.attempts + 1,
        locked_at: new Date().toISOString(),
        locked_by: workerId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', c.id)
      .eq('status', 'pending') // ← la condition qui rend la prise exclusive
      .eq('attempts', c.attempts)
      .select()
      .maybeSingle();

    if (error) {
      logEvent('warn', 'queue.claim', { status: 'claim_failed', error_code: error.code });
      continue;
    }
    if (data) claimed.push(data as Job);
    // data === null → un autre worker l'a pris entre-temps : on continue.
  }

  return claimed;
}

// ── Clôture ─────────────────────────────────────────────────────────────────

export async function markDone(supabase: Client, jobId: string): Promise<void> {
  const { error } = await q(supabase)
    .from('jobs')
    .update({
      status: 'done',
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
  if (error) throw new Error(`markDone: ${error.message}`);
}

/**
 * Échec : replanifie avec backoff, ou bascule en DLQ si `max_attempts` atteint.
 * Renvoie l'état final pour la journalisation du tick.
 */
export async function markFailed(
  supabase: Client,
  job: Job,
  errorMessage: string
): Promise<'failed' | 'dead'> {
  const exhausted = job.attempts >= job.max_attempts;
  const status = exhausted ? 'dead' : 'pending';

  const { error } = await q(supabase)
    .from('jobs')
    .update({
      status,
      locked_at: null,
      locked_by: null,
      last_error: errorMessage.slice(0, 2000),
      run_after: exhausted ? job.run_after : nextRunAfter(job.attempts).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  if (error) throw new Error(`markFailed: ${error.message}`);
  return exhausted ? 'dead' : 'failed';
}

/**
 * Report SANS consommer de tentative — quota épuisé, circuit ouvert.
 * `attempts` est décrémenté pour annuler l'incrément fait au moment du claim :
 * une attente légitime ne doit jamais rapprocher un job de la DLQ.
 */
export async function markRescheduled(
  supabase: Client,
  job: Job,
  runAfter: Date,
  reason: string
): Promise<void> {
  const { error } = await q(supabase)
    .from('jobs')
    .update({
      status: 'pending',
      locked_at: null,
      locked_by: null,
      attempts: Math.max(0, job.attempts - 1),
      last_error: reason.slice(0, 2000),
      run_after: runAfter.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
  if (error) throw new Error(`markRescheduled: ${error.message}`);
}

// ── Reprise des verrous morts ───────────────────────────────────────────────

/**
 * Sur Vercel, une fonction peut être tuée à tout instant (timeout,
 * redéploiement). Elle ne libère alors pas son verrou et le job resterait
 * « running » indéfiniment. Exécuté au début de chaque tick.
 */
export async function recoverStaleLocks(supabase: Client): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000).toISOString();

  // Idempotent : rejouer ce UPDATE ne peut que libérer les mêmes verrous morts.
  const { data, error } = await withGatewayRetry('recoverStaleLocks', () =>
    q(supabase)
      .from('jobs')
      .update({
        status: 'pending',
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'running')
      .lt('locked_at', cutoff)
      .select('id')
  );

  if (error) throw new Error(`recoverStaleLocks: ${error.message}`);
  const n = data?.length ?? 0;
  if (n > 0) logEvent('warn', 'queue.recover', { status: 'stale_locks_released', count: n });
  return n;
}

// ── Réglages tenant ─────────────────────────────────────────────────────────

export async function getTenantSettings(
  supabase: Client,
  tenantId: string
): Promise<TenantSettings | null> {
  const { data, error } = await q(supabase)
    .from('tenant_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`getTenantSettings: ${error.message}`);
  return (data as TenantSettings | null) ?? null;
}

/** Tenants dont le cron doit piloter la synchronisation. */
export async function listServerSyncTenants(supabase: Client): Promise<TenantSettings[]> {
  const { data, error } = await withGatewayRetry('listServerSyncTenants', () =>
    q(supabase)
      .from('tenant_settings')
      .select('*')
      .eq('auto_sync_enabled', true)
      .in('sync_source', ['server', 'both'])
  );
  if (error) throw new Error(`listServerSyncTenants: ${error.message}`);
  return (data as TenantSettings[]) ?? [];
}

export async function upsertTenantSettings(
  supabase: Client,
  tenantId: string,
  patch: Partial<Omit<TenantSettings, 'tenant_id' | 'created_at'>>
): Promise<void> {
  const { error } = await q(supabase)
    .from('tenant_settings')
    .upsert(
      { tenant_id: tenantId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' }
    );
  if (error) throw new Error(`upsertTenantSettings: ${error.message}`);
}

export async function setSyncSource(
  supabase: Client,
  tenantId: string,
  source: SyncSource
): Promise<void> {
  await upsertTenantSettings(supabase, tenantId, { sync_source: source });
}
