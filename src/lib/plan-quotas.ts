// Quotas mensuels par plan — appliqués sur les commandes synchronisées.
// Le compteur = orders.created_at dans le mois calendaire courant (Alger).
// null = illimité (Business, admin).

import type { SupabaseClient } from '@supabase/supabase-js';

export type PlanId = 'basic' | 'pro' | 'business';

export const PLAN_QUOTAS: Record<PlanId, number | null> = {
  basic: 200,
  pro: 2000,
  business: null,
};

export const PLAN_LABEL: Record<PlanId, string> = {
  basic: 'Basic',
  pro: 'Pro',
  business: 'Business',
};

export const PLAN_PRICE_DA: Record<PlanId, number> = {
  basic: 0,
  pro: 1900,
  business: 4900,
};

// Début du mois calendaire courant (ISO). Sert de borne inférieure pour compter
// les commandes créées ce mois-ci.
export function startOfCurrentMonthISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export interface QuotaState {
  planId: PlanId;
  planLabel: string;
  quota: number | null;
  used: number;
  remaining: number | null; // null si illimité
  percent: number; // 0..100, 0 si illimité
  isOver: boolean; // vrai quand used >= quota
  isNear: boolean; // ≥ 80% (à afficher en avertissement)
  isUnlimited: boolean;
}

// Compte les commandes créées ce mois-ci pour l'user donné.
export async function countOrdersThisMonth(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfCurrentMonthISO());
  return count ?? 0;
}

// Construit l'état complet du quota. Ignore le plan si role = 'admin' (illimité).
export function quotaStateFor(
  planId: string | null,
  role: string | null,
  used: number
): QuotaState {
  const plan: PlanId = (planId as PlanId) in PLAN_QUOTAS ? (planId as PlanId) : 'basic';
  const isAdmin = role === 'admin';
  const quota = isAdmin ? null : PLAN_QUOTAS[plan];
  const isUnlimited = quota === null;
  const remaining = isUnlimited ? null : Math.max(0, quota - used);
  const percent = isUnlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, quota)) * 100));
  return {
    planId: plan,
    planLabel: isAdmin ? 'Admin' : PLAN_LABEL[plan],
    quota,
    used,
    remaining,
    percent,
    isOver: !isUnlimited && used >= (quota ?? 0),
    isNear: !isUnlimited && percent >= 80,
    isUnlimited,
  };
}
