// Espace de travail (tenant) de l'utilisateur connecté.
//
// Jusqu'ici : tenant = utilisateur (`.eq('user_id', user.id)` partout). Avec les
// comptes employés, un employé qui a ACCEPTÉ l'invitation d'un marchand
// travaille dans l'espace de ce marchand : tenantId = owner_id.
//
// Règles de sécurité :
//   - l'appartenance se lit par `member_user_id` (identifiant du compte), jamais
//     par un e-mail fourni par le client ;
//   - seule une ligne `status = 'active'` compte — posée par acceptInvitation
//     après vérification de l'e-mail Google de l'invité ;
//   - toute erreur de lecture (table absente : migration 010 non exécutée, base
//     indisponible) → l'utilisateur reste propriétaire de SON propre espace.
//     Le repli ne donne donc jamais accès aux données d'un autre ;
//   - un Super Admin de la plateforme n'est jamais membre d'une équipe.

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';

export type TenantRole = 'owner' | 'employe';

export interface SessionUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
}

export interface TenantContext {
  /** Compte réellement connecté (l'acteur). */
  user: SessionUser;
  /** Espace dont on lit / écrit les données. */
  tenantId: string;
  role: TenantRole;
  /** Ligne autotim.team_members quand role = 'employe'. */
  membershipId: string | null;
}

type Service = ReturnType<typeof createServiceClient>;

// Une page déclenche plusieurs appels API d'un coup : on évite une lecture de
// team_members par appel. Révocation effective en ≤ 30 s (par instance).
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; tenantId: string; membershipId: string | null }>();

export function invalidateTenantCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export async function resolveTenant(
  user: SessionUser,
  service: Service = createServiceClient(),
  now: number = Date.now()
): Promise<TenantContext> {
  const own: TenantContext = { user, tenantId: user.id, role: 'owner', membershipId: null };
  if (isPlatformAdmin(user)) return own;

  const hit = cache.get(user.id);
  if (hit && now - hit.at < TTL_MS) {
    return hit.membershipId
      ? { user, tenantId: hit.tenantId, role: 'employe', membershipId: hit.membershipId }
      : own;
  }

  let row: { id?: unknown; owner_id?: unknown } | null = null;
  try {
    const { data, error } = await service
      .schema('autotim')
      .from('team_members')
      .select('id, owner_id')
      .eq('member_user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (error) return own; // pas de cache : on réessaiera au prochain appel
    row = data;
  } catch {
    return own;
  }

  const ownerId = typeof row?.owner_id === 'string' ? row.owner_id : '';
  const membershipId = typeof row?.id === 'string' ? row.id : '';
  if (!ownerId || !membershipId || ownerId === user.id) {
    cache.set(user.id, { at: now, tenantId: user.id, membershipId: null });
    return own;
  }
  cache.set(user.id, { at: now, tenantId: ownerId, membershipId });
  return { user, tenantId: ownerId, role: 'employe', membershipId };
}

/** Session + espace de travail. null si personne n'est connecté. */
export async function getTenantContext(): Promise<TenantContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return resolveTenant(user as SessionUser);
}

/**
 * E-mail de l'utilisateur, seulement s'il est prouvé par Google.
 *
 * `app_metadata.providers` est écrit par Supabase Auth (jamais par
 * l'utilisateur). Un compte créé par e-mail + mot de passe sur l'API publique
 * pourrait porter l'adresse de quelqu'un d'autre : il ne doit pas pouvoir
 * accepter une invitation destinée à cette adresse.
 */
export function verifiedGoogleEmail(user: SessionUser | null | undefined): string | null {
  if (!user?.email || !user.email_confirmed_at) return null;
  const meta = user.app_metadata ?? {};
  const providers = Array.isArray(meta.providers) ? meta.providers : [meta.provider];
  if (!providers.includes('google')) return null;
  return user.email.trim().toLowerCase();
}
