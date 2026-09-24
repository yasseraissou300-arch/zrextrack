// P3 — Erreurs Evolution : jamais le corps brut côté client.
//
// AVANT : « Evolution HTTP <code>: <120 à 200 premiers caractères du corps> » était
// renvoyé au navigateur, enregistré dans messages.error_message (affiché dans
// Messages), dans autotim.jobs.last_error (renvoyé par /api/jobs) et dans la
// réponse de résolution SAV. Tronquer n'est pas une protection : les 120
// premiers caractères suffisent pour
//   - une page d'erreur du proxy (Railway / Cloudflare) qui nomme l'HÔTE
//     Evolution — c'est l'URL qui protège les instances existantes (HUMAN-003) ;
//   - une erreur Prisma d'Evolution (« Invalid `prisma.message.create()`
//     invocation in /evolution/dist/… ») : chemin interne, requête, stack ;
//   - le numéro et le JID du destinataire.
//
// MAINTENANT : le corps est CLASSÉ côté serveur (catégorie + libellé constant),
// le client reçoit `Evolution HTTP <code> — <libellé> (réf E-xxxxxxxx)`, et le
// corps assaini est journalisé sous la même référence.

import { newErrorRef, redactForLog } from '@/lib/security/safe-error';
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

/** Catégorie d'une réponse d'erreur Evolution. Pure : lit le corps, ne le renvoie pas. */
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
 * Message SÛR pour le client / la base, et journalisation du corps assaini
 * sous une référence. `scope` identifie l'appelant dans les journaux.
 */
export function evolutionErrorMessage(
  scope: string,
  status: number,
  body: string,
  fields: Record<string, unknown> = {}
): { message: string; kind: EvolutionErrorKind; ref: string } {
  const kind = classifyEvolutionError(status, body);
  const ref = newErrorRef();
  logEvent('warn', scope, {
    ...fields,
    status: 'evolution_error',
    http_status: status,
    error_code: kind,
    reason: redactForLog(body),
    ref,
  });
  return { message: `Evolution HTTP ${status} — ${LABELS[kind]} (réf ${ref})`, kind, ref };
}

/**
 * Résumé d'un corps JSON Evolution pour le `debug` renvoyé au navigateur :
 * noms de clés et état de connexion, JAMAIS les valeurs. `/instance/create`
 * renvoie notamment `hash` = jeton de l'instance (contrôle total du numéro).
 */
export function describeEvolutionBody(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v))
    return { type: Array.isArray(v) ? 'array' : typeof v };
  const o = v as Record<string, unknown>;
  const inst = (o.instance ?? null) as Record<string, unknown> | null;
  const state =
    typeof inst?.state === 'string'
      ? inst.state
      : typeof o.state === 'string'
        ? o.state
        : undefined;
  return {
    keys: Object.keys(o).slice(0, 20),
    ...(state && /^\w{1,20}$/.test(state) ? { state } : {}),
  };
}
