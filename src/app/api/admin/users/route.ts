import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Gestion des clients du SaaS — réservé au Super Admin (profiles.role = 'admin').
// Utilise le service client (bypass RLS) pour voir/modifier TOUS les profils,
// APRÈS avoir vérifié que l'appelant est bien admin. La table profiles, elle,
// reste en RLS « propre profil seulement » pour le reste de l'app.

async function requireAdmin() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: 'Non authentifié' };

  const svc = createServiceClient();
  const { data: me } = await svc
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (me?.role !== 'admin') return { ok: false as const, status: 403, error: 'Accès réservé au Super Admin' };
  return { ok: true as const, svc };
}

export async function GET() {
  const a = await requireAdmin();
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });

  const { data, error } = await a.svc
    .from('profiles')
    .select('id, email, full_name, avatar_url, company_name, plan_id, status, role, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data || [] });
}

export async function PATCH(request: NextRequest) {
  const a = await requireAdmin();
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });

  const { userId, status, plan_id } = await request.json();
  if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 });

  const patch: Record<string, string> = {};
  if (status !== undefined) patch.status = status;
  if (plan_id !== undefined) patch.plan_id = plan_id;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Rien à modifier' }, { status: 400 });
  }

  const { error } = await a.svc.from('profiles').update(patch).eq('id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
