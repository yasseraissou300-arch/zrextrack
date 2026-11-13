// Côté invité : voir ses invitations, accepter / refuser, quitter une équipe.
//
// L'e-mail qui fait foi est celui du jeton Google de la session
// (verifiedGoogleEmail) — jamais une valeur envoyée par le navigateur.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantContext } from '@/lib/auth/tenant';
import { isForeignSiteRequest } from '@/lib/security/same-site';
import {
  acceptInvitation,
  declineInvitation,
  leaveTeam,
  pendingInvitations,
} from '@/lib/team/members';
import { logActivity } from '@/lib/team/activity';

const ACCEPT_ERRORS: Record<string, { status: number; error: string }> = {
  not_verified: { status: 403, error: 'Connectez-vous avec le compte Google invité' },
  not_found: { status: 404, error: 'Invitation introuvable ou déjà traitée' },
  already_member: { status: 409, error: 'Vous faites déjà partie d’une équipe' },
  unavailable: { status: 503, error: 'Équipe indisponible pour le moment' },
};

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  // Déjà employé quelque part : aucune autre invitation n'est proposée.
  if (ctx.role === 'employe') return NextResponse.json({ invitations: [] });

  const invitations = await pendingInvitations(createServiceClient(), ctx.user);
  return NextResponse.json({
    invitations: invitations.map((i) => ({ id: i.id, from: i.from })),
  });
}

export async function POST(request: NextRequest) {
  if (isForeignSiteRequest(request))
    return NextResponse.json({ error: 'Requête refusée' }, { status: 403 });
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? '');
  const id = typeof body?.id === 'string' ? body.id : '';
  const service = createServiceClient();

  if (action === 'leave') {
    if (ctx.role !== 'employe')
      return NextResponse.json({ error: 'Vous ne faites partie d’aucune équipe' }, { status: 400 });
    const ok = await leaveTeam(service, ctx.user.id);
    if (ok) await logActivity(service, ctx, 'team.leave', 'A quitté l’équipe');
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Action impossible pour le moment' }, { status: 503 });
  }

  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  if (action === 'accept') {
    const result = await acceptInvitation(service, ctx.user, id);
    if (!result.ok) {
      const e = ACCEPT_ERRORS[result.reason];
      return NextResponse.json({ error: e.error, reason: result.reason }, { status: e.status });
    }
    await logActivity(
      service,
      { tenantId: result.ownerId, role: 'employe', user: ctx.user },
      'team.join',
      'Invitation acceptée'
    );
    return NextResponse.json({ ok: true });
  }

  if (action === 'decline') {
    const ok = await declineInvitation(service, ctx.user, id);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Invitation introuvable ou déjà traitée' }, { status: 404 });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
