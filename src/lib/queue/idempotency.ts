// Clés d'idempotence — Phase 1.
//
// C'est la garantie qui rend la coexistence navigateur + cron sûre : les deux
// chemins calculent la MÊME clé pour le même travail, et l'index unique
// `jobs_idempotency_uniq` fait que le second enfilement est un no-op.
//
// Sans cela, basculer un tenant en `both` produirait deux syncs simultanés.

import { normalizePhone } from '@/lib/whatsapp/message-builder';

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

/**
 * `camp:<campagne>:<téléphone normalisé 213…>` — un destinataire servi une
 * seule fois.
 *
 * Le numéro est NORMALISÉ : « 0550… », « +213 550… » et « 00213550… » sont la
 * même personne. Avec le numéro brut, un client enregistré sous deux formats
 * dans `orders` recevait la campagne deux fois.
 */
export function campaignRecipientKey(campaignId: string, phone: string): string {
  return `camp:${campaignId}:${normalizePhone(phone)}`;
}

/**
 * Ancienne clé (numéro brut). Les jobs créés avant la normalisation la
 * portent : le dispatch la consulte pour ne pas recontacter, lors d'un renvoi,
 * un destinataire déjà servi sous l'ancien format.
 */
export function legacyCampaignRecipientKey(campaignId: string, phone: string): string {
  return `camp:${campaignId}:${phone}`;
}

/**
 * `campdisp:<campagne>:<offset>` (1er envoi) ou `campdisp:<campagne>:<run>:<offset>`
 * (renvoi) — un lot enfourné une seule fois PAR LANCEMENT.
 *
 * L'index jobs_idempotency_uniq n'est pas partiel : une clé reste prise pour
 * toujours. Sans `run`, « Renvoyer » une campagne terminée ré-enfilait
 * `campdisp:<id>:0`, déjà vue → no-op silencieux, campagne bloquée « en cours ».
 * Les clés destinataires (`camp:<id>:<tél>`) ne changent PAS : un renvoi ne
 * contacte que ceux qui n'ont pas encore reçu la campagne.
 */
export function campaignDispatchKey(campaignId: string, offset: number, run?: string): string {
  return run ? `campdisp:${campaignId}:${run}:${offset}` : `campdisp:${campaignId}:${offset}`;
}
