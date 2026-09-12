// File de jobs AutoTim — types partagés.
//
// La file vit dans le schéma PostgreSQL dédié `autotim`, jamais dans `public`
// (partagé avec une autre application qui a déjà écrasé une table métier).

/** Nom du schéma dédié. Doit être exposé dans Supabase → Settings → API. */
export const QUEUE_SCHEMA = 'autotim';

export type JobType = 'zrexpress.sync' | 'whatsapp.send' | 'campaign.dispatch';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'dead';

export type SyncSource = 'client' | 'server' | 'both';

export interface Job {
  id: string;
  tenant_id: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  run_after: string;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantSettings {
  tenant_id: string;
  auto_sync_enabled: boolean;
  sync_source: SyncSource;
  last_synced_at: string | null;
  consecutive_send_failures: number;
  circuit_open_until: string | null;
  created_at: string;
  updated_at: string;
}

// ── Payloads typés par type de job ──────────────────────────────────────────

export interface SyncPayload {
  /** Page de départ, pour un sync découpé si le chronométrage l'impose. */
  page?: number;
}

export interface WhatsAppSendPayload {
  /** Notification issue de public.pending_notifications. */
  notification_id?: string;
  /** Destinataire de campagne. */
  campaign_id?: string;
  phone: string;
  message: string;
  tracking_number?: string;
  customer_name?: string;
  media_url?: string;
}

export interface CampaignDispatchPayload {
  campaign_id: string;
  /** Curseur : index du premier destinataire du prochain lot. */
  offset: number;
}

/**
 * Nombre de tentatives par type.
 *
 * `whatsapp.send` = 1 délibérément : un envoi dont on ignore s'il est parti ne
 * doit JAMAIS être rejoué. Le doublon est précisément ce que l'algorithme
 * anti-spam de WhatsApp sanctionne. Un échec part en DLQ pour décision humaine.
 */
export const MAX_ATTEMPTS: Record<JobType, number> = {
  'zrexpress.sync': 3,
  'whatsapp.send': 1,
  'campaign.dispatch': 3,
};

/** Résultat rendu par un handler. */
export type HandlerResult =
  | { outcome: 'done' }
  /** Échec réel : consomme une tentative, part en DLQ au-delà de max_attempts. */
  | { outcome: 'failed'; error: string }
  /**
   * Report SANS consommer de tentative : quota journalier épuisé, circuit
   * ouvert… Ce n'est pas une erreur, c'est une attente légitime.
   */
  | { outcome: 'reschedule'; runAfter: Date; reason: string };

export type JobHandler = (job: Job) => Promise<HandlerResult>;
