// Jeton de vérification du webhook Meta (poignée de main GET hub.verify_token).
//
// L'ancien jeton était `zrex_fb_<8 premiers caractères de l'UUID>` : déductible
// de l'identifiant du marchand, qui n'est pas un secret. Avec la signature
// X-Hub-Signature-256 vérifiée sur les POST (P0-1), un jeton deviné ne permet
// plus d'injecter d'événements ; il reste un secret de protocole et n'a
// aucune raison d'être prévisible.

import crypto from 'crypto';
import { open, sealForStorage, secretContext, SecretError } from '@/lib/security/secret-box';
import { logEvent } from '@/lib/security/safe-log';

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

// ─── Jetons de page Facebook au repos (P2-9 phase 1b) ─────────────────────────
//
// facebook_connections.page_access_token : jeton de page LONGUE DURÉE (écrire
// au nom de la page, lire ses conversations). pending_pages : JSON des pages
// candidates, chacune AVEC son jeton — chiffré en bloc. Une ligne par
// utilisateur (onConflict user_id) → contexte AAD lié à l'utilisateur.

const FB_TABLE = 'facebook_connections';

function fbContext(userId: string, column: 'page_access_token' | 'pending_pages'): string {
  return secretContext(FB_TABLE, column, userId);
}

function openOrNull(
  userId: string,
  column: 'page_access_token' | 'pending_pages',
  stored: unknown
) {
  if (typeof stored !== 'string' || !stored) return null;
  try {
    return open(stored, fbContext(userId, column)).value || null;
  } catch (e) {
    logEvent('warn', 'secrets.facebook', {
      tenant_id: userId,
      status: 'unreadable',
      reason: column,
      error_code: e instanceof SecretError ? e.code : 'unknown',
    });
    return null;
  }
}

/** Valeur à stocker pour un jeton de page (chiffrée si le trousseau est configuré). */
export function sealPageToken(userId: string, token: string): string {
  return token ? sealForStorage(token, fbContext(userId, 'page_access_token')) : '';
}

/** Jeton de page en clair (serveur uniquement) ; null si absent ou illisible. */
export function openPageToken(userId: string, stored: unknown): string | null {
  return openOrNull(userId, 'page_access_token', stored);
}

/** Valeur à stocker pour la liste des pages en attente (JSON avec jetons). */
export function sealPendingPages(userId: string, json: string): string {
  return sealForStorage(json, fbContext(userId, 'pending_pages'));
}

/** JSON en clair des pages en attente (serveur uniquement) ; null si absent/illisible. */
export function openPendingPages(userId: string, stored: unknown): string | null {
  return openOrNull(userId, 'pending_pages', stored);
}
