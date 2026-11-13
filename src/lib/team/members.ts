// Comptes employés : invitation par le marchand, acceptation par l'invité.
//
// L'invité DOIT accepter : sans cette étape, n'importe quel compte pourrait
// « inviter » l'adresse d'un autre marchand et le faire basculer de force dans
// son espace (il ne verrait plus ses propres commandes).
//
// Toutes les écritures passent par service_role dans autotim.team_members
// (migration 010). Aucune suppression : une invitation change de statut.

import type { createServiceClient } from '@/lib/supabase/server';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import { invalidateTenantCache, verifiedGoogleEmail, type SessionUser } from '@/lib/auth/tenant';

type Service = ReturnType<typeof createServiceClient>;

/** Employés autorisés EN PLUS du propriétaire (tarifs : 1 / 5 / 20 utilisateurs). */
export const PLAN_SEATS: Record<string, number> = { basic: 0, pro: 4, business: 19 };

export function seatsForPlan(planId: string | null | undefined, admin = false): number {
  if (admin) return PLAN_SEATS.business;
  return PLAN_SEATS[String(planId ?? 'basic')] ?? 0;
}

export interface TeamMember {
  id: string;
  email: string;
  status: 'invited' | 'active';
  invited_at: string;
  accepted_at: string | null;
}

export interface Invitation {
  id: string;
  owner_id: string;
  from: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  const email = String(raw ?? '')
    .trim()
    .toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

const table = (service: Service) => service.schema('autotim').from('team_members');

export async function listMembers(service: Service, ownerId: string): Promise<TeamMember[] | null> {
  const { data, error } = await table(service)
    .select('id, email, status, invited_at, accepted_at')
    .eq('owner_id', ownerId)
    .in('status', ['invited', 'active'])
    .order('invited_at', { ascending: true });
  if (error) return null;
  return (data ?? []) as TeamMember[];
}

export type InviteResult =
  | { ok: true; member: TeamMember }
  | { ok: false; reason: 'invalid_email' | 'self' | 'seats_full' | 'already' | 'unavailable' };

export async function inviteMember(
  service: Service,
  owner: { id: string; email?: string | null },
  seats: number,
  rawEmail: unknown
): Promise<InviteResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, reason: 'invalid_email' };
  if (email === String(owner.email ?? '').toLowerCase()) return { ok: false, reason: 'self' };

  const members = await listMembers(service, owner.id);
  if (!members) return { ok: false, reason: 'unavailable' };
  if (members.some((m) => m.email === email)) return { ok: false, reason: 'already' };
  if (members.length >= seats) return { ok: false, reason: 'seats_full' };

  const { data, error } = await table(service)
    .insert({ owner_id: owner.id, email, role: 'employe', status: 'invited' })
    .select('id, email, status, invited_at, accepted_at')
    .maybeSingle();
  if (error) {
    // 23505 : invitation créée entre-temps (double clic, deux onglets)
    return { ok: false, reason: error.code === '23505' ? 'already' : 'unavailable' };
  }
  if (!data) return { ok: false, reason: 'unavailable' };
  return { ok: true, member: data as TeamMember };
}

/** Le marchand retire un employé (ou annule une invitation). */
export async function revokeMember(
  service: Service,
  ownerId: string,
  memberId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await table(service)
    .update({ status: 'revoked', ended_at: now, updated_at: now })
    .eq('id', memberId)
    .eq('owner_id', ownerId) // jamais l'employé d'un autre marchand
    .in('status', ['invited', 'active'])
    .select('member_user_id');
  if (error || !data?.length) return false;
  for (const r of data as { member_user_id?: string | null }[])
    if (r.member_user_id) invalidateTenantCache(r.member_user_id);
  return true;
}

/** Invitations en attente pour l'e-mail Google de l'utilisateur connecté. */
export async function pendingInvitations(
  service: Service,
  user: SessionUser
): Promise<Invitation[]> {
  const email = verifiedGoogleEmail(user);
  if (!email || isPlatformAdmin(user)) return [];
  const { data, error } = await table(service)
    .select('id, owner_id')
    .eq('email', email)
    .eq('status', 'invited')
    .order('invited_at', { ascending: true })
    .limit(5);
  if (error || !data?.length) return [];

  const rows = (data as { id: string; owner_id: string }[]).filter((r) => r.owner_id !== user.id);
  if (rows.length === 0) return [];
  const { data: profiles } = await service
    .from('profiles')
    .select('id, company_name, full_name, email')
    .in(
      'id',
      rows.map((r) => r.owner_id)
    );
  const byId = new Map(
    ((profiles ?? []) as Record<string, string | null>[]).map((p) => [String(p.id), p])
  );
  return rows.map((r) => {
    const p = byId.get(r.owner_id);
    return {
      id: r.id,
      owner_id: r.owner_id,
      from: p?.company_name || p?.full_name || p?.email || 'Un marchand',
    };
  });
}

export type AcceptResult =
  | { ok: true; ownerId: string }
  | { ok: false; reason: 'not_verified' | 'not_found' | 'already_member' | 'unavailable' };

/**
 * L'invité accepte : la ligne passe à `active` et se lie à SON compte.
 * L'e-mail comparé est celui du jeton Google, jamais une valeur du client.
 */
export async function acceptInvitation(
  service: Service,
  user: SessionUser,
  invitationId: string
): Promise<AcceptResult> {
  const email = verifiedGoogleEmail(user);
  if (!email || isPlatformAdmin(user)) return { ok: false, reason: 'not_verified' };

  const now = new Date().toISOString();
  const { data, error } = await table(service)
    .update({ status: 'active', member_user_id: user.id, accepted_at: now, updated_at: now })
    .eq('id', invitationId)
    .eq('email', email)
    .eq('status', 'invited')
    .neq('owner_id', user.id)
    .select('owner_id');
  if (error) {
    // 23505 : déjà membre actif d'une autre équipe (index unique)
    return { ok: false, reason: error.code === '23505' ? 'already_member' : 'unavailable' };
  }
  const ownerId = (data as { owner_id?: string }[] | null)?.[0]?.owner_id;
  if (!ownerId) return { ok: false, reason: 'not_found' };
  invalidateTenantCache(user.id);
  return { ok: true, ownerId };
}

export async function declineInvitation(
  service: Service,
  user: SessionUser,
  invitationId: string
): Promise<boolean> {
  const email = verifiedGoogleEmail(user);
  if (!email) return false;
  const now = new Date().toISOString();
  const { data, error } = await table(service)
    .update({ status: 'declined', ended_at: now, updated_at: now })
    .eq('id', invitationId)
    .eq('email', email)
    .eq('status', 'invited')
    .select('id');
  return !error && !!data?.length;
}

/** L'employé quitte l'équipe : il retrouve son propre espace. */
export async function leaveTeam(service: Service, userId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await table(service)
    .update({ status: 'left', ended_at: now, updated_at: now })
    .eq('member_user_id', userId)
    .eq('status', 'active')
    .select('id');
  invalidateTenantCache(userId);
  return !error && !!data?.length;
}
