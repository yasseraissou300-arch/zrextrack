// Comptes employés : un employé n'accède à l'espace d'un marchand que s'il a
// ACCEPTÉ une invitation adressée à SON e-mail Google. Tout le reste retombe
// sur son propre espace.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import { invalidateTenantCache, resolveTenant, verifiedGoogleEmail } from '@/lib/auth/tenant';
import {
  acceptInvitation,
  declineInvitation,
  inviteMember,
  leaveTeam,
  listMembers,
  pendingInvitations,
  revokeMember,
  seatsForPlan,
} from '@/lib/team/members';

const fake = new FakeSupabase();
const svc = fake as any;

const google = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id,
  email,
  email_confirmed_at: '2026-11-01T00:00:00Z',
  app_metadata: { provider: 'google', providers: ['google'] },
  ...extra,
});
const OWNER = google('owner-1', 'boss@shop.dz');
const EMP = google('emp-1', 'amina@gmail.com');

beforeEach(() => {
  fake.reset();
  invalidateTenantCache();
});

describe('verifiedGoogleEmail', () => {
  it('e-mail Google confirmé → minuscules', () => {
    expect(verifiedGoogleEmail(google('x', ' Amina@Gmail.com '))).toBe('amina@gmail.com');
  });
  it('compte e-mail/mot de passe, ou e-mail non confirmé → refusé', () => {
    expect(
      verifiedGoogleEmail({ ...EMP, app_metadata: { provider: 'email', providers: ['email'] } })
    ).toBeNull();
    expect(verifiedGoogleEmail({ ...EMP, email_confirmed_at: null })).toBeNull();
    expect(verifiedGoogleEmail({ id: 'x' })).toBeNull();
  });
});

describe('seatsForPlan', () => {
  it('Basic 0, Pro 4, Business 19 employés (1 / 5 / 20 utilisateurs)', () => {
    expect(seatsForPlan('basic')).toBe(0);
    expect(seatsForPlan('pro')).toBe(4);
    expect(seatsForPlan('business')).toBe(19);
    expect(seatsForPlan(null)).toBe(0);
    expect(seatsForPlan('inconnu')).toBe(0);
    expect(seatsForPlan('basic', true)).toBe(19);
  });
});

describe('invitation → acceptation → espace du marchand', () => {
  it('parcours complet', async () => {
    const inv = await inviteMember(svc, OWNER, 4, '  Amina@Gmail.com ');
    expect(inv.ok).toBe(true);
    // Invitée mais pas encore acceptée : l'employée reste dans SON espace
    expect((await resolveTenant(EMP, svc)).tenantId).toBe('emp-1');

    const pending = await pendingInvitations(svc, EMP);
    expect(pending).toHaveLength(1);
    expect((await acceptInvitation(svc, EMP, pending[0].id)).ok).toBe(true);

    expect(await resolveTenant(EMP, svc)).toMatchObject({ tenantId: 'owner-1', role: 'employe' });
    expect(await resolveTenant(OWNER, svc)).toMatchObject({ tenantId: 'owner-1', role: 'owner' });
  });

  it('retrait par le marchand → l’employée retrouve son propre espace', async () => {
    const inv = await inviteMember(svc, OWNER, 4, EMP.email);
    if (!inv.ok) throw new Error('invite');
    await acceptInvitation(svc, EMP, inv.member.id);
    expect((await resolveTenant(EMP, svc)).tenantId).toBe('owner-1');
    expect(await revokeMember(svc, 'owner-1', inv.member.id)).toBe(true);
    expect((await resolveTenant(EMP, svc)).tenantId).toBe('emp-1');
  });

  it('l’employée quitte l’équipe', async () => {
    const inv = await inviteMember(svc, OWNER, 4, EMP.email);
    if (!inv.ok) throw new Error('invite');
    await acceptInvitation(svc, EMP, inv.member.id);
    expect(await leaveTeam(svc, 'emp-1')).toBe(true);
    expect((await resolveTenant(EMP, svc)).role).toBe('owner');
  });
});

describe('sécurité', () => {
  it('on ne peut pas accepter une invitation adressée à un autre e-mail', async () => {
    const inv = await inviteMember(svc, OWNER, 4, 'amina@gmail.com');
    if (!inv.ok) throw new Error('invite');
    const intrus = google('intrus', 'intrus@gmail.com');
    expect(await acceptInvitation(svc, intrus, inv.member.id)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect((await resolveTenant(intrus, svc)).tenantId).toBe('intrus');
  });

  it('un compte non Google portant la bonne adresse ne peut pas accepter', async () => {
    const inv = await inviteMember(svc, OWNER, 4, 'amina@gmail.com');
    if (!inv.ok) throw new Error('invite');
    const faux = { ...EMP, app_metadata: { provider: 'email', providers: ['email'] } };
    expect((await acceptInvitation(svc, faux, inv.member.id)).ok).toBe(false);
    expect(await pendingInvitations(svc, faux)).toEqual([]);
  });

  it('un marchand ne peut pas retirer l’employé d’un autre marchand', async () => {
    const inv = await inviteMember(svc, OWNER, 4, EMP.email);
    if (!inv.ok) throw new Error('invite');
    await acceptInvitation(svc, EMP, inv.member.id);
    expect(await revokeMember(svc, 'autre-marchand', inv.member.id)).toBe(false);
    expect((await resolveTenant(EMP, svc)).tenantId).toBe('owner-1');
  });

  it('une invitation révoquée ou refusée ne peut plus être acceptée', async () => {
    const a = await inviteMember(svc, OWNER, 4, EMP.email);
    if (!a.ok) throw new Error('invite');
    await revokeMember(svc, 'owner-1', a.member.id);
    expect((await acceptInvitation(svc, EMP, a.member.id)).ok).toBe(false);

    const b = await inviteMember(svc, OWNER, 4, EMP.email);
    if (!b.ok) throw new Error('invite');
    expect(await declineInvitation(svc, EMP, b.member.id)).toBe(true);
    expect((await acceptInvitation(svc, EMP, b.member.id)).ok).toBe(false);
    expect((await resolveTenant(EMP, svc)).tenantId).toBe('emp-1');
  });

  it('un Super Admin n’est jamais basculé dans une équipe', async () => {
    const admin = google('adm', 'adm@gmail.com', {
      app_metadata: { provider: 'google', providers: ['google'], role: 'admin' },
    });
    fake.seed('autotim', 'team_members', [
      { owner_id: 'owner-1', email: 'adm@gmail.com', status: 'active', member_user_id: 'adm' },
    ]);
    expect((await resolveTenant(admin, svc)).tenantId).toBe('adm');
  });

  it('table absente (migration non exécutée) → chacun reste chez soi, sans erreur', async () => {
    fake.failNext('autotim', 'team_members', 'select', { code: '42P01' });
    expect(await resolveTenant(EMP, svc)).toMatchObject({ tenantId: 'emp-1', role: 'owner' });
    fake.failNext('autotim', 'team_members', 'select', { code: '42P01' });
    expect(await listMembers(svc, 'owner-1')).toBeNull();
  });
});

describe('inviteMember — règles', () => {
  it('refuse e-mail invalide, soi-même, doublon et dépassement d’offre', async () => {
    expect(await inviteMember(svc, OWNER, 4, 'pas-un-email')).toEqual({
      ok: false,
      reason: 'invalid_email',
    });
    expect(await inviteMember(svc, OWNER, 4, 'BOSS@shop.dz')).toEqual({
      ok: false,
      reason: 'self',
    });
    expect((await inviteMember(svc, OWNER, 1, 'a@x.dz')).ok).toBe(true);
    expect(await inviteMember(svc, OWNER, 1, 'a@x.dz')).toEqual({ ok: false, reason: 'already' });
    expect(await inviteMember(svc, OWNER, 1, 'b@x.dz')).toEqual({
      ok: false,
      reason: 'seats_full',
    });
    expect(await inviteMember(svc, OWNER, 0, 'c@x.dz')).toEqual({
      ok: false,
      reason: 'seats_full',
    });
  });

  it('une place libérée par un retrait peut être réutilisée', async () => {
    const a = await inviteMember(svc, OWNER, 1, 'a@x.dz');
    if (!a.ok) throw new Error('invite');
    await revokeMember(svc, 'owner-1', a.member.id);
    expect((await inviteMember(svc, OWNER, 1, 'b@x.dz')).ok).toBe(true);
  });
});
