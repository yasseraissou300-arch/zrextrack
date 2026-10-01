// Vérification HMAC-SHA256 (base64) des webhooks Shopify et WooCommerce.
//
// AVANT : chaque route faisait
//   if (integration.secret_key && !verify(...)) → 401
// Un secret_key vide — valeur par défaut de POST /api/integrations — désactivait
// donc toute vérification : quiconque connaissait le domaine de la boutique
// écrivait des commandes dans le tenant (FAIL-OPEN). La comparaison `===` n'était
// pas non plus à temps constant.
//
// MAINTENANT : FAIL-CLOSED. Secret absent, null, vide ou blanc → refus ; en-tête
// absent ou vide → refus ; comparaison à temps constant. Le secret est utilisé
// tel quel comme clé HMAC (il n'est jamais rogné : une clé réelle reste valide).

import crypto from 'crypto';

export type HmacCheck =
  | { ok: true }
  | { ok: false; reason: 'no_secret' | 'missing_signature' | 'bad_signature' };

export function verifyHmacSha256Base64(
  rawBody: string,
  providedSignature: string | null | undefined,
  secret: string | null | undefined
): HmacCheck {
  if (typeof secret !== 'string' || secret.trim() === '') return { ok: false, reason: 'no_secret' };
  const provided = (providedSignature ?? '').trim();
  if (!provided) return { ok: false, reason: 'missing_signature' };

  const expected = Buffer.from(
    crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64'),
    'utf8'
  );
  const got = Buffer.from(provided, 'utf8');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}
