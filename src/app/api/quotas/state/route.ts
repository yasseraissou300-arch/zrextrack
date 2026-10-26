import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { countOrdersThisMonth, quotaStateFor } from '@/lib/plan-quotas';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';

// Renvoie l'usage du user courant pour le mois calendaire en cours + son quota.
// Utilisé par QuotaBanner et par les écrans qui veulent afficher la progression.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const service = createServiceClient();
  const [{ data: prof }, used] = await Promise.all([
    service.from('profiles').select('plan_id').eq('id', user.id).maybeSingle(),
    countOrdersThisMonth(service, user.id),
  ]);

  // Quota illimité = Super Admin du JETON (app_metadata), jamais profiles.role
  // (modifiable par l'utilisateur selon la RLS — HUMAN-RLS-ROLE-001).
  const role = isPlatformAdmin(user) ? 'admin' : null;
  return NextResponse.json(quotaStateFor(prof?.plan_id ?? 'basic', role, used));
}
