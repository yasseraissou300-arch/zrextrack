// Équipe du marchand : liste, invitation, retrait d'un employé.
//
// Réservé au PROPRIÉTAIRE de l'espace. Un employé ne peut ni voir la liste, ni
// inviter, ni retirer quelqu'un.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/auth/tenant';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import { isForeignSiteRequest } from '@/lib/security/same-site';
import { inviteMember, listMembers, revokeMember, seatsForPlan } from '@/lib/team/members';
import { logActivity, recentActivity } from '@/lib/team/activity';

const INVITE_ERRORS: Record<string, { status: number; error: string }> = {
  invalid_email: { status: 400, error: 'Adresse e-mail invalide' },
  self: { status: 400, error: 'Vous ne pouvez pas vous inviter vous-même' },
  already: { status: 409, error: 'Cette personne est déjà invitée' },
  seats_full: { status: 403, error: 'Nombre maximum d’employés atteint pour votre offre' },
  unavailable: { status: 503, error: 'Équipe indisponible pour le moment' },
};

async function planOf(service: ReturnType<typeof createServiceClient>, userId: string) {
  const { data } = await service.from('profiles').select('plan_id').eq('id', userId).maybeSingle();
  return (data as { plan_id?: string | null } | null)?.plan_id ?? 'basic';
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const service = createServiceClient();
  if (ctx.role === 'employe') {
    const { data } = await service
      .from('profiles')
      .select('company_name, full_name')
      .eq('id', ctx.tenantId)
      .maybeSingle();
    const p = data as { company_name?: string | null; full_name?: string | null } | null;
    return NextResponse.json({
      role: 'employe',
      workspace: p?.company_name || p?.full_name || 'Espace du marchand',
    });
  }

  const [members, planId, activity] = await Promise.all([
    listMembers(service, ctx.user.id),
    planOf(service, ctx.user.id),
    recentActivity(service, ctx.user.id),
  ]);
  return NextResponse.json({
    role: 'owner',
    available: members !== null,
    members: members ?? [],
    seats: seatsForPlan(planId, isPlatformAdmin(ctx.user)),
    activity: activity ?? [],
  });
}

export async function POST(request: NextRequest) {
  if (isForeignSiteRequest(request))
    return NextResponse.json({ error: 'Requête refusée' }, { status: 403 });
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (ctx.role !== 'owner')
    return NextResponse.json({ error: 'Réservé au propriétaire du compte' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const service = createServiceClient();
  const seats = seatsForPlan(await planOf(service, ctx.user.id), isPlatformAdmin(ctx.user));
  const result = await inviteMember(service, ctx.user, seats, body?.email);
  if (!result.ok) {
    const e = INVITE_ERRORS[result.reason];
    return NextResponse.json({ error: e.error, reason: result.reason }, { status: e.status });
  }
  await logActivity(service, ctx, 'team.invite', `Invitation envoyée à ${result.member.email}`);
  return NextResponse.json({ member: result.member });
}

export async function PATCH(request: NextRequest) {
  if (isForeignSiteRequest(request))
    return NextResponse.json({ error: 'Requête refusée' }, { status: 403 });
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (ctx.role !== 'owner')
    return NextResponse.json({ error: 'Réservé au propriétaire du compte' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const service = createServiceClient();
  const ok = await revokeMember(service, ctx.user.id, id);
  if (!ok) return NextResponse.json({ error: 'Employé introuvable' }, { status: 404 });
  await logActivity(service, ctx, 'team.revoke', 'Accès d’un employé retiré');
  return NextResponse.json({ ok: true });
}
