// Secrets de tenant stockés en base, hors ZRExpress et Meta (P2-9, suite) :
//   - integrations.secret_key        : secret HMAC Shopify / WooCommerce
//   - voice_call_settings.auth_token : Auth Token Twilio
//
// Même module que la clé ZR (secret-box, AES-256-GCM, AAD liée au tenant) :
//   - écriture : chiffrée si SECRETS_KEYRING est configuré, sinon clair
//     (déploiement progressif ; SECRETS_REQUIRE_ENCRYPTION=1 → refus) ;
//   - lecture : le clair historique reste lisible ; une valeur illisible
//     (autre trousseau, autre tenant, altérée) → null, jamais d'exception ni
//     de fuite (log : code d'erreur seulement).
// Ces valeurs ne quittent jamais le serveur.

import {
  open,
  sealForStorage,
  maskSecret,
  secretContext,
  SecretError,
} from '@/lib/security/secret-box';
import { logEvent } from '@/lib/security/safe-log';

function openOrNull(
  stored: unknown,
  context: string,
  scope: string,
  tenantId: string
): string | null {
  if (typeof stored !== 'string' || !stored) return null;
  try {
    return open(stored, context).value || null;
  } catch (e) {
    logEvent('warn', scope, {
      tenant_id: tenantId,
      status: 'unreadable',
      error_code: e instanceof SecretError ? e.code : 'unknown',
    });
    return null;
  }
}

// ─── Shopify / WooCommerce ──────────────────────────────────────────────────
const integrationContext = (userId: string, platform: string) =>
  secretContext('integrations', 'secret_key', `${userId}:${platform}`);

export function sealIntegrationSecret(userId: string, platform: string, plain: string): string {
  return plain ? sealForStorage(plain, integrationContext(userId, platform)) : '';
}

export function openIntegrationSecret(
  userId: string,
  platform: string,
  stored: unknown
): string | null {
  return openOrNull(stored, integrationContext(userId, platform), 'secrets.integrations', userId);
}

// ─── Twilio ─────────────────────────────────────────────────────────────────
const twilioContext = (userId: string) =>
  secretContext('voice_call_settings', 'auth_token', userId);

export function sealTwilioToken(userId: string, plain: string): string {
  return plain ? sealForStorage(plain, twilioContext(userId)) : '';
}

export function openTwilioToken(userId: string, stored: unknown): string | null {
  return openOrNull(stored, twilioContext(userId), 'secrets.twilio', userId);
}

/** Affichage : jamais plus que les 4 derniers caractères du CLAIR. */
export function maskTwilioToken(userId: string, stored: unknown): string {
  return maskSecret(openTwilioToken(userId, stored));
}
