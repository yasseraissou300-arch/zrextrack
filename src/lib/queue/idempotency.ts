// Clés d'idempotence — Phase 1.
//
// C'est la garantie qui rend la coexistence navigateur + cron sûre : les deux
// chemins calculent la MÊME clé pour le même travail, et l'index unique
// `jobs_idempotency_uniq` fait que le second enfilement est un no-op.
//
// Sans cela, basculer un tenant en `both` produirait deux syncs simultanés.

/** Fenêtre de déduplication du sync : un seul par tenant et par créneau. */
export const SYNC_SLOT_SECONDS = 300; // 5 min — aligné sur la cadence du cron

/**
 * Créneau de 5 minutes contenant l'instant donné.
 * Le navigateur (setInterval 5 min) et le cron (toutes les 5 min) tombent dans
 * le même créneau : un seul des deux effectue le travail.
 */
export function syncSlot(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / SYNC_SLOT_SECONDS);
}

/** `sync:<tenant>:<créneau>` */
export function syncKey(tenantId: string, at: Date = new Date()): string {
  return `sync:${tenantId}:${syncSlot(at)}`;
}

/**
 * `notif:<tenant>:<tracking>:<statut>`
 * Aligné sur la contrainte `uniq_pending_notif (user_id, tracking_number,
 * delivery_status)` déjà présente en base — on ne duplique pas cette garantie,
 * on la prolonge jusqu'à la file.
 */
export function notificationKey(
  tenantId: string,
  trackingNumber: string,
  deliveryStatus: string
): string {
  return `notif:${tenantId}:${trackingNumber}:${deliveryStatus}`;
}

/** `camp:<campagne>:<téléphone>` — un destinataire servi une seule fois. */
export function campaignRecipientKey(campaignId: string, phone: string): string {
  return `camp:${campaignId}:${phone}`;
}

/** `campdisp:<campagne>:<offset>` — un lot enfourné une seule fois. */
export function campaignDispatchKey(campaignId: string, offset: number): string {
  return `campdisp:${campaignId}:${offset}`;
}
