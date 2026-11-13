// Journal « qui a fait quoi » dans l'espace d'un marchand (autotim.activity_log,
// migration 010). Jamais bloquant : une erreur d'écriture (table absente, base
// lente) est ignorée — l'action elle-même a déjà réussi.

import type { createServiceClient } from '@/lib/supabase/server';
import type { TenantContext } from '@/lib/auth/tenant';

type Service = ReturnType<typeof createServiceClient>;

export interface ActivityEntry {
  id: string;
  actor_email: string;
  actor_role: 'owner' | 'employe';
  action: string;
  summary: string;
  created_at: string;
}

export async function logActivity(
  service: Service,
  ctx: Pick<TenantContext, 'tenantId' | 'role' | 'user'>,
  action: string,
  summary: string
): Promise<void> {
  try {
    await service
      .schema('autotim')
      .from('activity_log')
      .insert({
        tenant_id: ctx.tenantId,
        actor_user_id: ctx.user.id,
        actor_email: String(ctx.user.email ?? '').slice(0, 254),
        actor_role: ctx.role,
        action: action.slice(0, 64),
        summary: summary.slice(0, 500),
      });
  } catch {
    /* journal facultatif */
  }
}

export async function recentActivity(
  service: Service,
  tenantId: string,
  limit = 50
): Promise<ActivityEntry[] | null> {
  const { data, error } = await service
    .schema('autotim')
    .from('activity_log')
    .select('id, actor_email, actor_role, action, summary, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return null;
  return (data ?? []) as ActivityEntry[];
}
