import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Renvoie l'utilisateur connecté + son profil. Le profil (dont le RÔLE) est lu
// via le service client (bypass RLS) : ainsi le rôle est TOUJOURS lisible, même
// si la RLS de la table profiles est cassée/récursive. C'est cette route qui
// alimente le badge « Super Admin », le lien sidebar, et la garde de /admin.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from('profiles')
    .select('full_name, avatar_url, company_name, plan_id, status, role, created_at')
    .eq('id', user.id)
    .single();

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    role: profile?.role ?? null,
    full_name: profile?.full_name ?? null,
    avatar_url: profile?.avatar_url ?? null,
    company_name: profile?.company_name ?? null,
    plan_id: profile?.plan_id ?? 'basic',
    status: profile?.status ?? null,
    created_at: profile?.created_at ?? null,
  });
}
