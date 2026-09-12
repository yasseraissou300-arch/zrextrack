// Circuit breaker WhatsApp — Phase 1.
//
// POURQUOI CE MODULE EXISTE (fait mesuré, pas hypothèse) :
// entre le 24 avril et le 30 juillet 2026, la session WhatsApp est morte et
// l'application a réessayé en boucle pendant trois mois. Résultat observé dans
// public.messages : 532 471 lignes en statut « echec », toutes portant
// « Session WhatsApp expirée (Connection Closed) — reconnecte le QR »,
// pour 45 messages réellement envoyés. 210 Mo, soit 42 % du quota Supabase.
//
// Deux barrières distinctes sont nécessaires, et il en fallait bien deux :
//   1. max_attempts = 1 sur whatsapp.send  → empêche de rejouer UN message
//   2. ce circuit breaker (niveau tenant)  → empêche de boucler sur TOUS
// La première seule n'aurait rien évité : chaque message échouait une fois,
// mais il y avait des milliers de messages et le cycle se répétait sans fin.

import type { TenantSettings } from './types';

export const CIRCUIT = {
  /** Échecs consécutifs avant ouverture. Aligné sur ANTI_SPAM.MAX_CONSECUTIVE_ERRORS. */
  THRESHOLD: 5,
  /** Durée d'ouverture. */
  OPEN_MS: 30 * 60_000,
};

export interface CircuitState {
  open: boolean;
  /** Instant de réouverture, si ouvert. */
  until: Date | null;
  failures: number;
}

/** Lit l'état du circuit à partir des réglages du tenant. */
export function circuitState(
  settings: Pick<TenantSettings, 'consecutive_send_failures' | 'circuit_open_until'> | null,
  now: Date = new Date()
): CircuitState {
  const failures = settings?.consecutive_send_failures ?? 0;
  const untilRaw = settings?.circuit_open_until ?? null;
  if (!untilRaw) return { open: false, until: null, failures };

  const until = new Date(untilRaw);
  if (Number.isNaN(until.getTime())) return { open: false, until: null, failures };

  return { open: until.getTime() > now.getTime(), until, failures };
}

/**
 * Nouvel état après un échec d'envoi.
 * Le circuit s'ouvre au franchissement du seuil et le reste OPEN_MS.
 */
export function afterFailure(
  current: number,
  now: Date = new Date()
): { failures: number; openUntil: Date | null } {
  const failures = current + 1;
  return {
    failures,
    openUntil: failures >= CIRCUIT.THRESHOLD ? new Date(now.getTime() + CIRCUIT.OPEN_MS) : null,
  };
}

/** Un succès referme le circuit et remet le compteur à zéro. */
export function afterSuccess(): { failures: number; openUntil: null } {
  return { failures: 0, openUntil: null };
}
