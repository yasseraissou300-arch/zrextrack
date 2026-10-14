// Erreurs Evolution : le corps de réponse n'est JAMAIS recopié (LOG-1).
//
// Avant : « Evolution HTTP <code>: <120-200 premiers caractères du corps> »
// partait dans autotim.jobs.last_error (GET /api/jobs), messages.error_message
// (page Messages), la réponse de /api/whatsapp/send, la réponse SAV et les
// journaux. Ce corps peut contenir le NUMÉRO / JID complet du destinataire,
// la page d'erreur du proxy qui nomme l'HÔTE Evolution (HUMAN-003), une erreur
// Prisma interne d'Evolution. Tronquer n'est pas une protection.
//
// Maintenant : le corps est CLASSÉ côté serveur (catégorie + libellé
// constant) ; seuls le code HTTP, la catégorie et une référence sortent.

import crypto from 'crypto';
import { logEvent } from '@/lib/security/safe-log';

export type EvolutionErrorKind =
  | 'session_closed'
  | 'number_not_on_whatsapp'
  | 'unauthorized'
  | 'instance_not_found'
  | 'rate_limited'
  | 'rejected'
  | 'server_error';

const LABELS: Record<EvolutionErrorKind, string> = {
  session_closed: 'session WhatsApp fermée, reconnecte le QR',
  number_not_on_whatsapp: "ce numéro n'a pas de compte WhatsApp",
  unauthorized: 'accès refusé par Evolution (clé)',
  instance_not_found: 'instance introuvable côté Evolution',
  rate_limited: 'trop de requêtes, réessaie plus tard',
  rejected: 'requête refusée par Evolution',
  server_error: 'erreur du serveur Evolution',
};

/** Catégorie d'une réponse d'erreur. Pure : lit le corps, ne le renvoie pas. */
export function classifyEvolutionError(status: number, body: string): EvolutionErrorKind {
  const b = body ?? '';
  if (/Connection Closed|Connection Failure|precondition/i.test(b)) return 'session_closed';
  if (/["']?exists["']?\s*:\s*false/i.test(b)) return 'number_not_on_whatsapp';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404 || /instance[^.]{0,80}(does not exist|not found)/i.test(b)) {
    return 'instance_not_found';
  }
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'rejected';
  return 'server_error';
}

/**
 * Message SÛR (client, base, journaux) : « Evolution HTTP <code> — <libellé>
 * (réf E-xxxxxxxx) ». Le journal reçoit la même référence, le code et la
 * catégorie — jamais le corps.
 */
export function evolutionErrorMessage(scope: string, status: number, body: string): string {
  const kind = classifyEvolutionError(status, body);
  const ref = `E-${crypto.randomBytes(4).toString('hex')}`;
  logEvent('warn', scope, {
    status: 'evolution_error',
    http_status: status,
    error_code: kind,
    ref,
  });
  return `Evolution HTTP ${status} — ${LABELS[kind]} (réf ${ref})`;
}
