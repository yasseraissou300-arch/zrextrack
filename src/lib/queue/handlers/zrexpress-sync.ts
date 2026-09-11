// Handler `zrexpress.sync` — synchronise les colis d'un tenant.
//
// Reprend la logique de src/app/api/sync-zrexpress/route.ts, à une différence
// près, structurante : au lieu de DRAINER les notifications en ligne avec des
// sleep() (ce qui imposait la fenêtre HTTP), il ENFILE un job whatsapp.send par
// notification, espacé par run_after. Le throttle anti-ban est identique —
// seul le mécanisme d'attente change.
//
// La route HTTP reste en place pour le bouton « Synchroniser » manuel.

import { createServiceClient } from '@/lib/supabase/server';
import { fetchAllParcels } from '@/lib/zrexpress/parcels';
import { mapParcel, dedupeByTracking } from '@/lib/zrexpress/map-parcel';
import { buildMessage, loadUserTemplates, NOTIFY_STATUSES } from '@/lib/whatsapp/message-builder';
import { randomThrottle } from '@/lib/whatsapp/anti-spam';
import { countOrdersThisMonth, quotaStateFor } from '@/lib/plan-quotas';
import { logEvent } from '@/lib/security/safe-log';
import { enqueue, upsertTenantSettings } from '../repository';
import { notificationKey } from '../idempotency';
import type { Job, HandlerResult, WhatsAppSendPayload } from '../types';

/**
 * Espacement du PREMIER envoi après un sync. Les suivants s'échelonnent avec
 * randomThrottle() (20-60 s), exactement comme l'envoi manuel.
 */
const FIRST_SEND_DELAY_MS = 5_000;

/**
 * Notifications enfilées par sync. Reprend DRAIN_PER_SYNC = 2 de l'existant :
 * on ne change pas le rythme observé aujourd'hui, seulement son exécution.
 */
const NOTIFS_PER_SYNC = 2;

export async function handleZrexpressSync(job: Job): Promise<HandlerResult> {
  const supabase = createServiceClient();
  const tenantId = job.tenant_id;

  // ── 1. Credentials ZRExpress du tenant ────────────────────────────────────
  const { data: settings } = await supabase
    .from('user_sync_settings')
    .select('zrexpress_token, zrexpress_tenant_id, notify_enabled')
    .eq('user_id', tenantId)
    .maybeSingle();

  const token = settings?.zrexpress_token;
  const zrTenant = settings?.zrexpress_tenant_id;
  if (!token || !zrTenant) {
    return { outcome: 'failed', error: 'token ou tenant ZRExpress non configuré' };
  }

  // ── 2. Quota mensuel du plan ──────────────────────────────────────────────
  const { data: prof } = await supabase
    .from('profiles')
    .select('plan_id, role')
    .eq('id', tenantId)
    .maybeSingle();

  const used = await countOrdersThisMonth(supabase, tenantId);
  const quota = quotaStateFor(prof?.plan_id ?? 'basic', prof?.role ?? null, used);

  if (quota.isOver) {
    // Pas un échec : le tenant a atteint son plan. On réessaiera le mois suivant.
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
    nextMonth.setHours(0, 5, 0, 0);
    return {
      outcome: 'reschedule',
      runAfter: nextMonth,
      reason: `quota mensuel atteint (${quota.used}/${quota.quota})`,
    };
  }

  // ── 3. Récupération ZRExpress ─────────────────────────────────────────────
  const parcels = await fetchAllParcels(token, zrTenant);
  if (parcels.length === 0) {
    await upsertTenantSettings(supabase, tenantId, { last_synced_at: new Date().toISOString() });
    return { outcome: 'done' };
  }

  const syncedAt = new Date().toISOString();
  let rows = dedupeByTracking(parcels.map((p) => mapParcel(p, syncedAt)));

  // Ne pas dépasser le quota mensuel restant.
  if (!quota.isUnlimited && quota.remaining != null && rows.length > quota.remaining) {
    rows = rows.slice(0, quota.remaining);
  }

  const trackingNums = rows.map((r) => r.tracking_number);

  // ── 4. Détection des changements de statut ────────────────────────────────
  const { data: existing } = await supabase
    .from('orders')
    .select('tracking_number, delivery_status')
    .eq('user_id', tenantId)
    .in('tracking_number', trackingNums);

  const previous = new Map(
    ((existing as Array<{ tracking_number: string; delivery_status: string }>) ?? []).map((o) => [
      o.tracking_number,
      o.delivery_status,
    ])
  );

  const notifyEnabled = (settings?.notify_enabled ?? {}) as Record<string, boolean>;
  const toNotify = rows.filter(
    (r) =>
      NOTIFY_STATUSES.has(r.delivery_status) &&
      notifyEnabled[r.delivery_status] !== false &&
      r.customer_whatsapp &&
      r.customer_whatsapp.length > 4 &&
      previous.get(r.tracking_number) !== r.delivery_status
  );

  // ── 5. Upsert des commandes ───────────────────────────────────────────────
  const { error: upsertErr } = await supabase.from('orders').upsert(
    rows.map((r) => ({ ...r, user_id: tenantId })),
    { onConflict: 'user_id,tracking_number' }
  );

  if (upsertErr) return { outcome: 'failed', error: `upsert orders: ${upsertErr.message}` };

  // ── 6. File de notifications ──────────────────────────────────────────────
  // `pending_notifications` conserve son rôle : sa contrainte unique
  // (user_id, tracking_number, delivery_status) garantit déjà l'anti-doublon.
  if (toNotify.length > 0) {
    await supabase.from('pending_notifications').upsert(
      toNotify.map((n) => ({
        user_id: tenantId,
        tracking_number: n.tracking_number,
        delivery_status: n.delivery_status,
        customer_name: n.customer_name,
        customer_whatsapp: n.customer_whatsapp,
        wilaya: n.wilaya,
        product_name: n.product_name,
        cod: n.cod,
        status: 'pending',
      })),
      { onConflict: 'user_id,tracking_number,delivery_status', ignoreDuplicates: true }
    );
  }

  // ── 7. Enfilement des envois ──────────────────────────────────────────────
  const enqueued = await enqueuePendingNotifications(supabase, tenantId);

  await upsertTenantSettings(supabase, tenantId, { last_synced_at: syncedAt });

  logEvent('info', 'queue.sync', {
    tenant_id: tenantId,
    status: 'done',
    synced: rows.length,
    notifications: toNotify.length,
    enqueued,
  });

  return { outcome: 'done' };
}

/**
 * Enfile jusqu'à NOTIFS_PER_SYNC envois depuis `pending_notifications`.
 *
 * L'espacement se fait par `run_after` croissant (randomThrottle, 20-60 s) au
 * lieu d'un sleep() : le tick n'attend pas, la file s'en charge. Le rythme
 * observé par WhatsApp est identique.
 */
async function enqueuePendingNotifications(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string
): Promise<number> {
  const { data: pendings } = await supabase
    .from('pending_notifications')
    .select('*')
    .eq('user_id', tenantId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(NOTIFS_PER_SYNC);

  if (!pendings?.length) return 0;

  const templates = await loadUserTemplates(supabase, tenantId);
  let offset = FIRST_SEND_DELAY_MS;
  let count = 0;

  for (const p of pendings as Array<Record<string, any>>) {
    const message = buildMessage(
      p.delivery_status,
      {
        customer_name: p.customer_name || '',
        tracking_number: p.tracking_number,
        wilaya: p.wilaya || '',
        product_name: p.product_name || '',
        cod: p.cod ?? 0,
      },
      templates
    );

    const payload: WhatsAppSendPayload = {
      notification_id: p.id,
      phone: p.customer_whatsapp || '',
      message,
      tracking_number: p.tracking_number,
      customer_name: p.customer_name || '',
    };

    const created = await enqueue(supabase, {
      tenantId,
      type: 'whatsapp.send',
      payload: payload as unknown as Record<string, unknown>,
      runAfter: new Date(Date.now() + offset),
      idempotencyKey: notificationKey(tenantId, p.tracking_number, p.delivery_status),
    });

    if (created) count++;
    offset += randomThrottle(); // 20-60 s entre deux envois — inchangé
  }

  return count;
}
