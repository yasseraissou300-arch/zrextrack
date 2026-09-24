// Identifiants ZRExpress — STRICTEMENT côté serveur (P2-9 phase 1).
//
// Avant : GET /api/sync-settings renvoyait la clé API ZR en clair au
// navigateur, qui la renvoyait dans le corps de 7 routes. La clé transitait
// donc par l'état React, les outils du navigateur, les extensions, et
// n'importe quel appelant pouvait faire agir le serveur avec une clé de son
// choix.
//
// Maintenant : la clé est lue en base pour le tenant de la SESSION, déchiffrée
// ici (secret-box, tolérant au clair historique) et ne quitte jamais le
// serveur. Une clé fournie dans le corps d'une requête est IGNORÉE.

import type { createServiceClient } from '@/lib/supabase/server';
import {
  open,
  sealForStorage,
  maskSecret,
  secretContext,
  SecretError,
} from '@/lib/security/secret-box';
import { logEvent } from '@/lib/security/safe-log';

type Client = ReturnType<typeof createServiceClient>;

export const ZR_TOKEN_TABLE = 'user_sync_settings';
export const ZR_TOKEN_COLUMN = 'zrexpress_token';

export function zrTokenContext(userId: string): string {
  return secretContext(ZR_TOKEN_TABLE, ZR_TOKEN_COLUMN, userId);
}

export interface ZrCredentials {
  token: string;
  tenantId: string;
}

/** Valeur à stocker pour une clé saisie (chiffrée si le trousseau est configuré). */
export function sealZrToken(userId: string, token: string): string {
  return sealForStorage(token, zrTokenContext(userId));
}

/** Clair d'une valeur stockée, ou null si illisible (jamais d'exception ni de fuite). */
export function openZrToken(userId: string, stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return open(stored, zrTokenContext(userId)).value || null;
  } catch (e) {
    logEvent('warn', 'secrets.zrexpress', {
      tenant_id: userId,
      status: 'unreadable',
      error_code: e instanceof SecretError ? e.code : 'unknown',
    });
    return null;
  }
}

/** Identifiants ZR du tenant, ou null si non configurés / illisibles. */
export async function getZrCredentials(
  supabase: Client,
  userId: string
): Promise<ZrCredentials | null> {
  const { data } = await supabase
    .from(ZR_TOKEN_TABLE)
    .select('zrexpress_token, zrexpress_tenant_id')
    .eq('user_id', userId)
    .maybeSingle();
  const token = openZrToken(userId, data?.zrexpress_token);
  const tenantId = (data?.zrexpress_tenant_id as string | null) ?? '';
  if (!token || !tenantId) return null;
  return { token, tenantId };
}

/** Ce que le navigateur a le droit de savoir : configuré ou non, et 4 caractères. */
export function publicZrStatus(
  userId: string,
  stored: string | null | undefined
): { zrexpress_configured: boolean; zrexpress_token_masked: string } {
  const plain = openZrToken(userId, stored);
  return { zrexpress_configured: !!plain, zrexpress_token_masked: maskSecret(plain) };
}

/** Réponse standard quand les identifiants manquent. */
export const ZR_NOT_CONFIGURED = {
  error: 'Clé API ZRExpress non configurée — va sur /sync pour la saisir',
  code: 'ZR_NOT_CONFIGURED',
} as const;
