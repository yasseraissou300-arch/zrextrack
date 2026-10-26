// Aperçu d'un RENVOI de campagne (statut termine / annule).
//
// Pourquoi : avec #127, « Renvoyer » enfile réellement. Les clés
// destinataires (`camp:<id>:<tél>`) empêchent tout doublon, MAIS l'audience
// d'une campagne non personnalisée est recalculée EN DIRECT depuis `orders` :
// un renvoi contacterait aussi tous les clients arrivés depuis le premier
// envoi. C'est un nouveau broadcast, pas une reprise. La route exige donc une
// confirmation explicite portant le chiffre exact de l'audience affiché au
// marchand ; un chiffre périmé (audience changée entre-temps) est refusé.

import type { createServiceClient } from '@/lib/supabase/server';
import { QUEUE_SCHEMA } from '@/lib/queue/types';

type Client = ReturnType<typeof createServiceClient>;

export interface RelaunchPreview {
  /** Taille actuelle de l'audience (personnalisée ou recalculée depuis orders). */
  audience: number;
  /** Destinataires déjà enfilés pour cette campagne (clé camp:<id>:…). */
  already_served: number;
  /** Au plus : audience − déjà servis (ceux qu'un renvoi peut contacter). */
  max_new_recipients: number;
  /** Audience recalculée en direct (true) ou liste figée (false). */
  dynamic_audience: boolean;
}

export async function relaunchPreview(
  supabase: Client,
  tenantId: string,
  campaign: { id: string; audience_phones?: string[] | null; audience_status?: string | null }
): Promise<RelaunchPreview | null> {
  const custom = campaign.audience_phones ?? null;
  let audience: number;
  if (custom && custom.length > 0) {
    audience = custom.length;
  } else {
    let q = supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', tenantId)
      .not('customer_whatsapp', 'is', null)
      .neq('customer_whatsapp', '');
    if (campaign.audience_status) q = q.eq('delivery_status', campaign.audience_status);
    const { count, error } = await q;
    if (error || count == null) return null;
    audience = count;
  }

  const { count: served, error: jErr } = await supabase
    .schema(QUEUE_SCHEMA)
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('type', 'whatsapp.send')
    .like('idempotency_key', `camp:${campaign.id}:%`);
  if (jErr || served == null) return null;

  return {
    audience,
    already_served: served,
    max_new_recipients: Math.max(0, audience - served),
    dynamic_audience: !(custom && custom.length > 0),
  };
}

/** La confirmation reçue correspond-elle EXACTEMENT à l'aperçu courant ? */
export function relaunchConfirmed(body: unknown, preview: RelaunchPreview): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as { confirm_relaunch?: unknown; expected_audience?: unknown };
  return b.confirm_relaunch === true && b.expected_audience === preview.audience;
}
