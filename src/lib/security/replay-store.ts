// Anti-rejeu DURABLE des webhooks — partagé entre toutes les instances Vercel.
//
// isReplay() (webhook-auth.ts) garde les identifiants en mémoire : chaque
// instance serverless a sa propre Map, vide après un démarrage à froid. Un même
// message WhatsApp livré deux fois (retry d'Evolution après une réponse lente,
// ré-émission Baileys à la reconnexion) sur deux instances passait le filtre —
// l'IA répondait deux fois, deux WhatsApp partaient.
//
// Ici : INSERT ... ON CONFLICT DO NOTHING sur la clé primaire de
// autotim.webhook_events (db/proposed/006). Postgres garantit qu'un seul appel
// insère la ligne, quel que soit le nombre d'instances concurrentes.
//
// Sans la table (migration 006 pas encore exécutée) ou en cas d'erreur base,
// on retombe sur le cache mémoire : jamais moins protégé qu'avant.
//
// SÉMANTIQUE : « au plus une fois ». L'événement est marqué AVANT son
// traitement ; si le traitement échoue, un retry du fournisseur est ignoré.
// Choix délibéré : un message perdu vaut mieux que deux réponses du bot.

import type { createServiceClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/security/safe-log';
import { isReplay } from '@/lib/security/webhook-auth';

type Client = ReturnType<typeof createServiceClient>;

export const REPLAY_RETENTION_DAYS = 7;
/** Une requête sur N déclenche la purge (pas de tâche planifiée dédiée). */
export const PRUNE_ONE_IN = 200;
const MAX_KEY_LENGTH = 200;

/**
 * true si `eventKey` a déjà été vu (par N'IMPORTE quelle instance).
 * La première occurrence est enregistrée de façon atomique.
 */
export async function isReplayDurable(
  supabase: Client,
  eventKey: string,
  random: () => number = Math.random
): Promise<boolean> {
  if (!eventKey) return false;
  const key = eventKey.slice(0, MAX_KEY_LENGTH);

  // Le cache mémoire reste la première barrière : zéro requête pour un
  // rejeu rapproché sur la même instance.
  if (isReplay(key)) return true;

  const { data, error } = await supabase
    .schema('autotim')
    .from('webhook_events')
    .upsert({ event_key: key }, { onConflict: 'event_key', ignoreDuplicates: true })
    .select('event_key');

  if (error) {
    // Table absente (006 non exécutée) ou base indisponible : le cache mémoire
    // a déjà enregistré la clé ci-dessus — comportement d'avant, pas pire.
    logEvent('warn', 'webhook.replay', {
      status: 'durable_store_unavailable',
      error_code: error.code,
    });
    return false;
  }

  if (random() < 1 / PRUNE_ONE_IN) void prune(supabase);

  // Ligne renvoyée → insérée par NOUS → première occurrence.
  // Aucune ligne → conflit → déjà vue ailleurs.
  return !(Array.isArray(data) && data.length > 0);
}

/**
 * Fenêtre de rejeu : un événement plus ancien que la rétention du store est
 * refusé. Sans elle, un message re-émis après la purge (ré-émission Baileys à
 * la reconnexion, synchro d'historique) serait vu comme NOUVEAU et retraité.
 * `tsSeconds` = horodatage du fournisseur (WhatsApp : messageTimestamp, en
 * secondes ; nombre, chaîne ou Long {low}). Absent ou illisible → pas stale
 * (comportement inchangé).
 */
export function isStaleEvent(tsSeconds: unknown, now: number = Date.now()): boolean {
  const raw =
    tsSeconds && typeof tsSeconds === 'object' && 'low' in (tsSeconds as Record<string, unknown>)
      ? (tsSeconds as { low: unknown }).low
      : tsSeconds;
  const sec = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return false;
  return now - sec * 1000 > REPLAY_RETENTION_DAYS * 86_400_000;
}

/**
 * Variante « au moins une fois » (commandes Shopify / WooCommerce) : on
 * VÉRIFIE avant le traitement et on ENREGISTRE après succès. Un échec de
 * traitement n'enregistre rien : le fournisseur réessaie avec le même
 * identifiant et la commande n'est pas perdue. Deux livraisons concurrentes
 * passent toutes deux : l'écriture (upsert onConflict) est idempotente.
 * Table absente / erreur base → non vu (comportement d'avant).
 */
export async function hasSeenDurable(supabase: Client, eventKey: string): Promise<boolean> {
  if (!eventKey) return false;
  const { data, error } = await supabase
    .schema('autotim')
    .from('webhook_events')
    .select('event_key')
    .eq('event_key', eventKey.slice(0, MAX_KEY_LENGTH))
    .maybeSingle();
  if (error) {
    logEvent('warn', 'webhook.replay', {
      status: 'durable_store_unavailable',
      error_code: error.code,
    });
    return false;
  }
  return !!data;
}

export async function recordSeenDurable(supabase: Client, eventKey: string): Promise<void> {
  if (!eventKey) return;
  const { error } = await supabase
    .schema('autotim')
    .from('webhook_events')
    .upsert(
      { event_key: eventKey.slice(0, MAX_KEY_LENGTH) },
      { onConflict: 'event_key', ignoreDuplicates: true }
    );
  if (error) {
    logEvent('warn', 'webhook.replay', {
      status: 'durable_store_unavailable',
      error_code: error.code,
    });
  }
}

async function prune(supabase: Client): Promise<void> {
  const cutoff = new Date(Date.now() - REPLAY_RETENTION_DAYS * 86_400_000).toISOString();
  const { error } = await supabase
    .schema('autotim')
    .from('webhook_events')
    .delete()
    .lt('received_at', cutoff);
  if (error) {
    logEvent('warn', 'webhook.replay', { status: 'prune_failed', error_code: error.code });
  }
}
