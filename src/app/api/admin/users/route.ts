import { internalErrorResponse } from '@/lib/security/public-error';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import { PLAN_QUOTAS } from '@/lib/plan-quotas';

// Gestion des clients du SaaS — réservé au Super Admin (app_metadata.role =
// 'admin' du jeton Supabase Auth ; jamais profiles.role, modifiable par
// l'utilisateur selon la RLS — HUMAN-RLS-ROLE-001).
// Utilise le service client (bypass RLS) pour voir/modifier TOUS les profils,
// APRÈS avoir vérifié que l'appelant est bien admin. La table profiles, elle,
// reste en RLS « propre profil seulement » pour le reste de l'app.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['active', 'blocked', 'pending']; // CHECK de profiles.status

async function requireAdmin() {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: 'Non authentifié' };

  if (!isPlatformAdmin(user))
    return { ok: false as const, status: 403, error: 'Accès réservé au Super Admin' };
  return { ok: true as const, svc: createServiceClient() };
}

export async function GET() {
  const a = await requireAdmin();
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });

  const { data, error } = await a.svc
    .from('profiles')
    .select('id, email, full_name, avatar_url, company_name, plan_id, status, role, created_at')
    .order('created_at', { ascending: false });

  if (error) return internalErrorResponse('api.admin.users', error, 500);
  return NextResponse.json({ users: data || [] });
}

export async function PATCH(request: NextRequest) {
  const a = await requireAdmin();
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });

  const { userId, status, plan_id } = await request.json().catch(() => ({}));
  if (typeof userId !== 'string' || !UUID.test(userId))
    return NextResponse.json({ error: 'userId invalide' }, { status: 400 });
  if (status !== undefined && !STATUSES.includes(status))
    return NextResponse.json(
      { error: `status doit valoir ${STATUSES.join(', ')}` },
      { status: 400 }
    );
  if (plan_id !== undefined && !Object.hasOwn(PLAN_QUOTAS, plan_id))
    return NextResponse.json({ error: 'plan_id inconnu' }, { status: 400 });

  const patch: Record<string, string> = {};
  if (status !== undefined) patch.status = status;
  if (plan_id !== undefined) patch.plan_id = plan_id;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Rien à modifier' }, { status: 400 });
  }

  const { error } = await a.svc.from('profiles').update(patch).eq('id', userId);
  if (error) return internalErrorResponse('api.admin.users', error, 500);
  return NextResponse.json({ ok: true });
}
