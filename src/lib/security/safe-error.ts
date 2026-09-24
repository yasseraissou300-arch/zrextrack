// P3 — Réponses d'erreur sûres.
//
// AVANT : `NextResponse.json({ error: error.message }, { status: 500 })` dans
// ~45 routes. Le message brut PostgREST / PostgreSQL / réseau part au
// navigateur : noms de tables et de colonnes, contraintes, « permission denied
// for table … », hôtes internes. Sur /api/health (public), n'importe qui le lit.
//
// MAINTENANT : le client reçoit un message générique et une référence courte ;
// le serveur journalise la même référence avec le CODE d'erreur et un message
// assaini (jetons, clés, URL de requête, numéros masqués). Le support retrouve
// le détail à partir de la référence, sans que le détail quitte le serveur.

import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { logEvent } from './safe-log';

export const GENERIC_ERROR = 'Erreur interne. Réessaie dans un instant.';
export const UPSTREAM_ERROR = 'Service externe indisponible. Réessaie dans un instant.';

/**
 * Code sûr à journaliser : code PostgREST / PostgreSQL (`42P01`, `PGRST116`…),
 * code système (`ECONNREFUSED`), ou nom de la classe d'erreur. Jamais le message.
 */
export function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,32}$/.test(code)) return code;
    const cause = (err as { cause?: { code?: unknown } }).cause;
    if (cause && typeof cause.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(cause.code)) {
      return cause.code;
    }
    if (err instanceof Error && /^[A-Za-z]{1,40}$/.test(err.name)) return err.name;
  }
  return 'unknown';
}

const REDACTIONS: Array<[RegExp, string]> = [
  [/eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, '[jwt]'],
  [/\b(Bearer|Basic)\s+[\w\-.~+/=]{8,}/gi, '$1 [redacted]'],
  [/\b(sb_(?:secret|publishable)_[\w-]+|sk-[\w-]{10,}|AIza[\w-]{20,}|enc:v1:[^\s"']+)/g, '[key]'],
  [
    /([?&](?:key|apikey|api_key|token|access_token|secret|password|signature)=)[^&\s"']+/gi,
    '$1[redacted]',
  ],
  [/(\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1[creds]@'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\+?\d[\d\s-]{8,}\d/g, '[num]'],
  [/\b[A-Za-z0-9+/_=-]{40,}\b/g, '[opaque]'],
];

/** Message assaini et tronqué, pour les journaux serveur UNIQUEMENT. */
export function redactForLog(message: unknown, max = 300): string {
  let s = typeof message === 'string' ? message : message instanceof Error ? message.message : '';
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  return s.slice(0, max);
}

/** Référence courte à communiquer au support (`E-` + 8 hex). */
export function newErrorRef(): string {
  return `E-${randomBytes(4).toString('hex')}`;
}

/**
 * Journalise l'erreur côté serveur et renvoie au client un message SÛR.
 *
 * @param scope   identifiant de la route (`api.orders`), pour les journaux
 * @param err     l'erreur brute — ne quitte jamais le serveur
 * @param status  code HTTP (500 par défaut, 502 pour un service externe)
 * @param message message client, CONSTANT (jamais dérivé de `err`)
 */
export function internalError(
  scope: string,
  err: unknown,
  status = 500,
  message: string = status === 502 ? UPSTREAM_ERROR : GENERIC_ERROR
): NextResponse {
  const ref = newErrorRef();
  logEvent('error', scope, {
    status: 'error',
    http_status: status,
    error_code: errorCode(err),
    reason: redactForLog(
      err && typeof err === 'object' && 'message' in err
        ? (err as { message: unknown }).message
        : err
    ),
    ref,
  });
  return NextResponse.json({ error: message, ref }, { status });
}
