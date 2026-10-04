// Catégorie d'une réponse d'erreur de la Graph API (envoi Messenger).
//
// Pure : lit le statut HTTP et le code d'erreur NUMÉRIQUE du corps Graph
// (`error.code`), ne renvoie jamais le corps lui-même — il contient le message
// d'erreur Facebook, qui peut citer le destinataire ou le texte envoyé.
// Codes Graph documentés : 190 jeton invalide/expiré ; 10 et 200-299
// permission ; 4, 17, 32, 613 limite de débit ; 551 destinataire indisponible.

export type GraphErrorKind =
  | 'token_invalid'
  | 'permission_denied'
  | 'rate_limited'
  | 'recipient_unavailable'
  | 'unauthorized'
  | 'rejected'
  | 'server_error';

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/** Code numérique `error.code` du corps Graph, ou undefined (corps illisible). */
function graphCode(body: string): number | undefined {
  try {
    const code = (JSON.parse(body) as { error?: { code?: unknown } })?.error?.code;
    return Number.isInteger(code) ? (code as number) : undefined;
  } catch {
    return undefined;
  }
}

export function classifyGraphError(
  status: number,
  body: string
): { kind: GraphErrorKind; graphCode?: number } {
  const code = graphCode(body ?? '');
  const kind: GraphErrorKind =
    code === 190
      ? 'token_invalid'
      : code === 10 || (code !== undefined && code >= 200 && code < 300)
        ? 'permission_denied'
        : status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))
          ? 'rate_limited'
          : code === 551
            ? 'recipient_unavailable'
            : status === 401 || status === 403
              ? 'unauthorized'
              : status >= 400 && status < 500
                ? 'rejected'
                : 'server_error';
  return code === undefined ? { kind } : { kind, graphCode: code };
}
