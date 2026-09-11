// Boucle d'exécution bornée en temps — Phase 1.
//
// Sur Vercel Hobby, maxDuration plafonne à 60 s. Le tick s'arrête volontairement
// bien avant : il travaille tant qu'il reste du budget, puis rend la main
// proprement. Le tick suivant reprend là où celui-ci s'est arrêté.
//
// Budget 25 s (et non 50) pour rester compatible avec TOUS les schedulers,
// y compris ceux dont le timeout de requête est court (cron-job.org).

import { createServiceClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/security/safe-log';
import { claimJobs, markDone, markFailed, markRescheduled } from './repository';
import type { Job, JobHandler, JobType } from './types';

export const TICK = {
  /** Budget applicatif total. */
  BUDGET_MS: 25_000,
  /** Marge réservée pour clôturer et répondre. */
  RESERVE_MS: 3_000,
  /** Jobs réclamés par lot. */
  CLAIM_BATCH: 5,
};

export interface TickStats {
  claimed: number;
  done: number;
  failed: number;
  dead: number;
  rescheduled: number;
  budget_exhausted: boolean;
}

/**
 * Draine la file jusqu'à épuisement du budget.
 *
 * Un job n'est JAMAIS démarré s'il ne reste pas au moins RESERVE_MS : mieux
 * vaut le laisser au tick suivant que le faire tuer en plein vol.
 */
export async function runTick(
  handlers: Partial<Record<JobType, JobHandler>>,
  workerId: string,
  startedAt: number = Date.now()
): Promise<TickStats> {
  const supabase = createServiceClient();
  const stats: TickStats = {
    claimed: 0,
    done: 0,
    failed: 0,
    dead: 0,
    rescheduled: 0,
    budget_exhausted: false,
  };

  const remaining = () => TICK.BUDGET_MS - (Date.now() - startedAt);

  while (remaining() > TICK.RESERVE_MS) {
    const jobs = await claimJobs(supabase, TICK.CLAIM_BATCH, workerId);
    if (jobs.length === 0) break; // file vide

    stats.claimed += jobs.length;

    for (const job of jobs) {
      if (remaining() <= TICK.RESERVE_MS) {
        // Budget épuisé en cours de lot : on rend le job à la file sans
        // consommer de tentative. Il repartira au tick suivant.
        await markRescheduled(supabase, job, new Date(), 'budget du tick épuisé');
        stats.rescheduled++;
        stats.budget_exhausted = true;
        continue;
      }
      await executeOne(supabase, job, handlers, stats);
    }
  }

  if (remaining() <= TICK.RESERVE_MS) stats.budget_exhausted = true;
  return stats;
}

async function executeOne(
  supabase: ReturnType<typeof createServiceClient>,
  job: Job,
  handlers: Partial<Record<JobType, JobHandler>>,
  stats: TickStats
): Promise<void> {
  const handler = handlers[job.type];

  // Reprise d'un verrou mort : le claim a porté `attempts` AU-DELÀ de
  // max_attempts (la contrainte jobs_attempts_chk autorise max_attempts + 1
  // précisément pour ce cas). On ignore si l'exécution interrompue a produit
  // son effet — pour un whatsapp.send, le message est peut-être parti.
  // Ne JAMAIS rejouer : le job part en DLQ pour décision humaine.
  if (job.attempts > job.max_attempts) {
    await markFailed(supabase, job, 'tentatives épuisées après reprise d’un verrou mort');
    stats.dead++;
    logEvent('warn', 'queue.job', {
      tenant_id: job.tenant_id,
      event: job.type,
      status: 'dead',
      reason: 'stale_lock_recovered_exhausted',
    });
    return;
  }

  if (!handler) {
    const outcome = await markFailed(supabase, job, `aucun handler pour ${job.type}`);
    if (outcome === 'dead') stats.dead++;
    else stats.failed++;
    return;
  }

  try {
    const result = await handler(job);

    if (result.outcome === 'done') {
      await markDone(supabase, job.id);
      stats.done++;
      return;
    }

    if (result.outcome === 'reschedule') {
      await markRescheduled(supabase, job, result.runAfter, result.reason);
      stats.rescheduled++;
      logEvent('info', 'queue.job', {
        tenant_id: job.tenant_id,
        event: job.type,
        status: 'rescheduled',
        reason: result.reason,
      });
      return;
    }

    const outcome = await markFailed(supabase, job, result.error);
    if (outcome === 'dead') stats.dead++;
    else stats.failed++;
    logEvent('warn', 'queue.job', {
      tenant_id: job.tenant_id,
      event: job.type,
      status: outcome,
      reason: result.error.slice(0, 200),
    });
  } catch (e) {
    // Un handler qui lève ne doit jamais faire tomber le tick entier.
    const message = e instanceof Error ? e.message : String(e);
    const outcome = await markFailed(supabase, job, message);
    if (outcome === 'dead') stats.dead++;
    else stats.failed++;
    logEvent('error', 'queue.job', {
      tenant_id: job.tenant_id,
      event: job.type,
      status: outcome,
      reason: message.slice(0, 200),
    });
  }
}
