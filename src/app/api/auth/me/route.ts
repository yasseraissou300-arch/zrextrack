import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import { resolveTenant } from '@/lib/auth/tenant';

// Renvoie l'utilisateur connecté + son profil. Le profil (dont le RÔLE) est lu
// via le service client (bypass RLS) : ainsi le rôle est TOUJOURS lisible, même
// si la RLS de la table profiles est cassée/récursive. C'est cette route qui
// alimente le badge « Super Admin », le lien sidebar, et la garde de /admin.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const svc = createServiceClient();
  const [{ data: profile }, workspace] = await Promise.all([
    svc
      .from('profiles')
      .select('full_name, avatar_url, company_name, plan_id, status, role, created_at')
      .eq('id', user.id)
      .single(),
    resolveTenant(user, svc),
  ]);

  // Employé : nom de l'espace du marchand (affiché dans la barre latérale).
  let workspaceName: string | null = null;
  if (workspace.role === 'employe') {
    const { data: owner } = await svc
      .from('profiles')
      .select('company_name, full_name')
      .eq('id', workspace.tenantId)
      .maybeSingle();
    const o = owner as { company_name?: string | null; full_name?: string | null } | null;
    workspaceName = o?.company_name || o?.full_name || 'Espace du marchand';
  }

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    // « admin » seulement si le jeton le porte (app_metadata) : même source
    // que les gardes serveur. Un profiles.role = 'admin' posé par
    // l'utilisateur lui-même n'affiche plus le badge ni le lien Admin.
    role: isPlatformAdmin(user)
      ? 'admin'
      : profile?.role === 'admin'
        ? 'user'
        : (profile?.role ?? null),
    full_name: profile?.full_name ?? null,
    avatar_url: profile?.avatar_url ?? null,
    company_name: profile?.company_name ?? null,
    plan_id: profile?.plan_id ?? 'basic',
    status: profile?.status ?? null,
    created_at: profile?.created_at ?? null,
    workspace_role: workspace.role,
    workspace_name: workspaceName,
  });
}
