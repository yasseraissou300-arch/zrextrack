// Échecs Gemini (pool de clés BYOK du chatbot WhatsApp / Messenger) — journal sûr.
//
// La clé Gemini voyage dans l'URL (`?key=`) : l'URL, le message d'une
// exception (qui la cite), la pile et le corps de réponse Google (qui peut citer
// l'URL, le projet ou le prompt) ne sont JAMAIS journalisés. On ne garde que
// des valeurs ÉNUMÉRÉES : statut HTTP, `error.status` / `reason` Google (lus
// pour classer, pas recopiés), `finishReason` validé, rang de la clé dans le
// pool (1..n — jamais la clé, ni un fragment, ni une empreinte).

import { newErrorRef } from '@/lib/security/safe-error';
import { logEvent } from '@/lib/security/safe-log';

export type GeminiErrorKind =
  | 'invalid_key'
  | 'bad_request'
  | 'authentication_error'
  | 'rate_limited'
  | 'provider_error'
  | 'network_error'
  | 'empty_response';

export interface GeminiCallCtx {
  channel: 'whatsapp' | 'messenger';
  tenantId: string;
}

/** Catégorie d'une réponse HTTP ≠ 2xx. Pure : le corps est lu, jamais renvoyé. */
export function classifyGeminiHttpError(status: number, body: string): GeminiErrorKind {
  let reason = '';
  let gStatus = '';
  try {
    const err = (
      JSON.parse(body) as {
        error?: { status?: unknown; details?: Array<{ reason?: unknown }> };
      }
    )?.error;
    gStatus = typeof err?.status === 'string' ? err.status : '';
    reason = (err?.details ?? []).map((d) => d?.reason).find((r) => typeof r === 'string') ?? '';
  } catch {
    /* corps illisible (HTML de proxy…) : classement par le seul statut */
  }
  if (reason === 'API_KEY_INVALID') return 'invalid_key';
  if (status === 429 || gStatus === 'RESOURCE_EXHAUSTED') return 'rate_limited';
  if (status === 401 || status === 403) return 'authentication_error';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'provider_error';
}

/** `finishReason` Gemini uniquement s'il a la forme d'une valeur énumérée. */
export function safeFinishReason(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Z_]{1,40}$/.test(v) ? v : undefined;
}

/** Une clé du pool a échoué (le parcours du pool continue, inchangé). */
export function logGeminiKeyFailure(
  ctx: GeminiCallCtx,
  keyIndex: number,
  poolSize: number,
  fields: { http_status?: number; error_code: GeminiErrorKind; finish_reason?: string }
): void {
  logEvent('warn', 'ai.gemini', {
    tenant_id: ctx.tenantId,
    channel: ctx.channel,
    status: 'failed',
    key_index: keyIndex,
    pool_size: poolSize,
    ...fields,
    ref: newErrorRef(),
  });
}

/** Aucune clé du pool n'a produit de réponse. */
export function logGeminiPoolExhausted(ctx: GeminiCallCtx, poolSize: number): void {
  logEvent('warn', 'ai.gemini', {
    tenant_id: ctx.tenantId,
    channel: ctx.channel,
    status: 'all_keys_failed',
    pool_size: poolSize,
    ref: newErrorRef(),
  });
}
