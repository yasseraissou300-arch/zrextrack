import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { countOrdersThisMonth, quotaStateFor } from '@/lib/plan-quotas';

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
    service.from('profiles').select('plan_id, role').eq('id', user.id).maybeSingle(),
    countOrdersThisMonth(service, user.id),
  ]);

  return NextResponse.json(quotaStateFor(prof?.plan_id ?? 'basic', prof?.role ?? null, used));
}
