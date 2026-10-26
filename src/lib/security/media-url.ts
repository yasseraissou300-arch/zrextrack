// URL de média fournie par un marchand (chatbot_configs.media_url,
// campaigns.media_url). Ce n'est pas notre serveur qui la télécharge mais
// Evolution (hébergé sur Railway) : une adresse interne (*.railway.internal,
// Redis / Postgres d'Evolution, métadonnées) ferait de lui un relais SSRF.
// Vérification à l'enregistrement : http(s), hôte public (DNS compris).

import { assertPublicUrl, OutboundBlocked, type LookupFn } from '@/lib/security/safe-outbound';

const MAX_LENGTH = 2_048;

/** null si acceptable (vide compris), sinon message destiné au marchand. */
export async function mediaUrlError(value: unknown, lookup?: LookupFn): Promise<string | null> {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_LENGTH) return 'URL du média invalide';
  try {
    await assertPublicUrl(value.trim(), lookup);
    return null;
  } catch (e) {
    const reason = e instanceof OutboundBlocked ? e.reason : 'invalid_url';
    if (reason === 'private_address') return 'URL du média refusée : adresse locale ou privée';
    if (reason === 'dns_failed') return 'URL du média injoignable (nom de domaine introuvable)';
    return 'URL du média invalide (http:// ou https:// attendu)';
  }
}
