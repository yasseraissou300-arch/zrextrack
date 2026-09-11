// Point d'entrée du scheduler — Phase 1.
//
// Appelé toutes les 5 minutes par cron-job.org (scheduler principal).
// L'application n'a AUCUNE dépendance envers ce fournisseur : changer de
// scheduler revient à changer une URL dans une interface web.
//
// GitHub Actions a été écarté sur mesure : 11 exécutions planifiées observées
// sur ce dépôt, retard médian 3 h 19, maximum 5 h 40, 0 à l'heure.
//
// L'endpoint est IDEMPOTENT : plusieurs schedulers peuvent l'appeler
// simultanément sans produire de travail en double (idempotency_key).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verifyWebhookSecret } from '@/lib/security/webhook-auth';
import { logEvent } from '@/lib/security/safe-log';
import { runTick, TICK } from '@/lib/queue/runner';
import { enqueue, listServerSyncTenants, recoverStaleLocks } from '@/lib/queue/repository';
import { syncKey } from '@/lib/queue/idempotency';
import { handleZrexpressSync } from '@/lib/queue/handlers/zrexpress-sync';
import { handleWhatsAppSend } from '@/lib/queue/handlers/whatsapp-send';
import { handleCampaignDispatch } from '@/lib/queue/handlers/campaign-dispatch';
import type { JobHandler, JobType } from '@/lib/queue/types';

// Vercel Hobby : défaut 10 s, plafond 60 s. Sans déclaration explicite, le tick
// serait coupé à 10 s en plein drain. 30 s laisse 5 s de marge au-dessus du
// budget applicatif de 25 s.
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const HANDLERS: Partial<Record<JobType, JobHandler>> = {
  'zrexpress.sync': handleZrexpressSync,
  'whatsapp.send': handleWhatsAppSend,
  'campaign.dispatch': handleCampaignDispatch,
};

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // ── Authentification ──────────────────────────────────────────────────────
  // Secret DISTINCT de CRON_SECRET (utilisé par /api/ai-chatbot/relance) :
  // deux déclencheurs, deux secrets, révocables séparément.
  const auth = verifyWebhookSecret(req, 'CRON_TICK_SECRET');
  if (!auth.ok) {
    logEvent('warn', 'cron.tick', { status: 'rejected', reason: auth.reason });
    return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
  }
  if (auth.mode === 'unenforced') {
    logEvent('warn', 'cron.tick', {
      status: 'unauthenticated_accepted',
      reason: 'CRON_TICK_SECRET non défini — endpoint ouvert',
    });
  }

  const workerId = `tick-${crypto.randomUUID().slice(0, 8)}`;

  try {
    const supabase = createServiceClient();

    // ── 1. Reprise des verrous morts ────────────────────────────────────────
    // Une fonction Vercel tuée (timeout, redéploiement) ne libère pas son
    // verrou : sans cette étape le job resterait « running » pour toujours.
    const recovered = await recoverStaleLocks(supabase);

    // ── 2. Planification des syncs ──────────────────────────────────────────
    const scheduled = await scheduleTenantSyncs(supabase);

    // ── 3. Drain, borné en temps ────────────────────────────────────────────
    const stats = await runTick(HANDLERS, workerId, startedAt);

    const elapsed = Date.now() - startedAt;
    logEvent('info', 'cron.tick', {
      status: 'ok',
      worker: workerId,
      recovered,
      scheduled,
      ...stats,
      elapsed_ms: elapsed,
    });

    return NextResponse.json({
      ok: true,
      worker: workerId,
      recovered,
      scheduled,
      ...stats,
      elapsed_ms: elapsed,
      budget_ms: TICK.BUDGET_MS,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logEvent('error', 'cron.tick', {
      status: 'exception',
      worker: workerId,
      reason: message.slice(0, 300),
      elapsed_ms: Date.now() - startedAt,
    });
    // 500 pour que le scheduler le signale, sans détail interne exposé.
    return NextResponse.json({ ok: false, error: 'tick failed' }, { status: 500 });
  }
}

/**
 * Enfile un `zrexpress.sync` par tenant éligible.
 *
 * Éligible = auto_sync_enabled ET sync_source dans ('server', 'both').
 * Aucun tenant n'est éligible par défaut : `sync_source` vaut 'client' à la
 * création, donc le navigateur reste seul maître jusqu'à bascule explicite.
 *
 * L'idempotency_key `sync:<tenant>:<créneau-5min>` fait que le navigateur et le
 * cron ne peuvent pas produire deux syncs dans le même créneau.
 */
async function scheduleTenantSyncs(
  supabase: ReturnType<typeof createServiceClient>
): Promise<number> {
  const tenants = await listServerSyncTenants(supabase);
  let scheduled = 0;

  for (const t of tenants) {
    const created = await enqueue(supabase, {
      tenantId: t.tenant_id,
      type: 'zrexpress.sync',
      payload: {},
      idempotencyKey: syncKey(t.tenant_id),
    });
    if (created) scheduled++;
  }

  return scheduled;
}

/** Sonde de disponibilité — ne déclenche aucun travail. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'autotim-tick',
    budget_ms: TICK.BUDGET_MS,
    max_duration_s: maxDuration,
  });
}
