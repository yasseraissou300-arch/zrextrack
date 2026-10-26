// Validation à l'enregistrement de chatbot_configs.google_sheets_url (aucun
// réseau). La résolution DNS et les redirections sont revérifiées à l'envoi
// (safePostJson).

import { checkOutboundUrl, OutboundBlocked } from '@/lib/security/safe-outbound';

const MAX_LENGTH = 2_048;

/** null si acceptable (vide compris), sinon un message destiné au marchand. */
export function sheetsUrlError(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_LENGTH) return 'URL Google Sheets invalide';
  try {
    checkOutboundUrl(value.trim());
    return null;
  } catch (e) {
    const reason = e instanceof OutboundBlocked ? e.reason : 'invalid_url';
    if (reason === 'private_address') return 'URL refusée : adresse locale ou privée';
    if (reason === 'credentials_in_url')
      return "URL refusée : retirez l'identifiant et le mot de passe";
    return 'URL Google Sheets invalide (http:// ou https:// attendu)';
  }
}
