// Média envoyé via Evolution (sendMedia) — fermeture du risque SSRF / DNS
// rebinding côté Evolution.
//
// Evolution (Railway) téléchargeait lui-même l'URL fournie par le marchand :
// même vérifiée à l'enregistrement puis à l'envoi, un nom de domaine pouvait
// être repointé vers une adresse interne entre notre contrôle et SA propre
// résolution DNS. Désormais :
//   - stockage maîtrisé (Supabase Storage public de la plateforme, utilisé
//     par les uploads de campagne) → l'URL est transmise telle quelle ;
//   - toute autre URL → téléchargée par NOTRE serveur (garde SSRF à chaque
//     saut, 16 Mo max, types média seulement) puis transmise en base64 :
//     Evolution ne résout plus jamais un nom fourni par un tenant.

import {
  safeGetBytes,
  OutboundBlocked,
  OutboundTooLarge,
  type SafePostDeps,
} from '@/lib/security/safe-outbound';

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // limite WhatsApp

const ALLOWED_TYPES =
  /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime|3gpp)|audio\/(mpeg|ogg|mp4|aac|amr)|application\/pdf)$/;

export type MediaRefusal = 'invalid_url' | 'blocked' | 'too_large' | 'bad_type' | 'download_failed';

export type PreparedMedia =
  | { ok: true; media: string; mimetype?: string; source: 'own_storage' | 'proxied' }
  | { ok: false; reason: MediaRefusal };

/** URL publique du stockage Supabase de la plateforme ? */
export function isOwnStorageUrl(
  raw: string,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
): boolean {
  if (!supabaseUrl) return false;
  try {
    const u = new URL(raw);
    const own = new URL(supabaseUrl);
    return (
      u.protocol === 'https:' &&
      u.hostname === own.hostname &&
      !u.username &&
      !u.password &&
      (u.port === '' || u.port === '443') &&
      u.pathname.startsWith('/storage/v1/object/public/') &&
      !u.pathname.includes('..')
    );
  } catch {
    return false;
  }
}

export async function prepareMediaForEvolution(
  raw: string,
  deps: SafePostDeps = {}
): Promise<PreparedMedia> {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'invalid_url' };
  const url = raw.trim();
  if (isOwnStorageUrl(url)) return { ok: true, media: url, source: 'own_storage' };
  try {
    const { bytes, contentType } = await safeGetBytes(url, { ...deps, maxBytes: MAX_MEDIA_BYTES });
    if (!ALLOWED_TYPES.test(contentType)) return { ok: false, reason: 'bad_type' };
    if (bytes.byteLength === 0) return { ok: false, reason: 'download_failed' };
    return {
      ok: true,
      media: Buffer.from(bytes).toString('base64'),
      mimetype: contentType,
      source: 'proxied',
    };
  } catch (e) {
    if (e instanceof OutboundTooLarge) return { ok: false, reason: 'too_large' };
    if (e instanceof OutboundBlocked)
      return {
        ok: false,
        reason:
          e.reason === 'network_error' || e.reason === 'timeout' ? 'download_failed' : 'blocked',
      };
    return { ok: false, reason: 'download_failed' };
  }
}
