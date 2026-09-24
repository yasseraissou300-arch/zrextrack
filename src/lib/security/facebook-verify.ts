// Jeton de vérification du webhook Meta (poignée de main GET hub.verify_token).
//
// L'ancien jeton était `zrex_fb_<8 premiers caractères de l'UUID>` : déductible
// de l'identifiant du marchand, qui n'est pas un secret. Avec la signature
// X-Hub-Signature-256 vérifiée sur les POST (P0-1), un jeton deviné ne permet
// plus d'injecter d'événements ; il reste un secret de protocole et n'a
// aucune raison d'être prévisible.

import crypto from 'crypto';

/** 144 bits aléatoires, préfixe conservé pour la lisibilité dans l'interface. */
export function newVerifyToken(): string {
  return `zrex_fb_${crypto.randomBytes(18).toString('base64url')}`;
}

/** Comparaison à temps constant (longueurs différentes → false). */
export function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Retire les jetons d'accès des pages avant tout envoi au navigateur. */
export function publicPendingPages(
  raw: string | null | undefined
): Array<{ id: string; name: string; picture: string }> | null {
  if (!raw) return null;
  try {
    const pages = JSON.parse(raw) as Array<{ id?: unknown; name?: unknown; picture?: unknown }>;
    if (!Array.isArray(pages)) return null;
    return pages.map((p) => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      picture: String(p.picture ?? ''),
    }));
  } catch {
    return null;
  }
}
