// Historique d'un client AVANT de confirmer sa commande :
//   - ses colis passés chez ZRExpress (table orders du marchand) : livrés /
//     refusés → même score que la page Clients (fidèle … à risque) ;
//   - doublons : le même numéro a d'autres commandes en attente.
// En paiement à la livraison, c'est ce qui décide d'appeler avant d'expédier.

import type { createServiceClient } from '@/lib/supabase/server';
import { riskLevel, type RiskLevel } from '@/lib/clients/risk';
import { normalizePhone } from '@/lib/whatsapp/message-builder';

type Service = ReturnType<typeof createServiceClient>;

export interface CustomerHistory {
  livre: number;
  refus: number;
  level: RiskLevel;
}

/** Écritures possibles d'un même numéro dans orders.customer_whatsapp. */
export function phoneVariants(phone213: string): string[] {
  const p = normalizePhone(phone213);
  if (!/^213\d{8,9}$/.test(p)) return [p];
  const local = p.slice(3);
  return [p, `+${p}`, `0${local}`, local];
}

const CHUNK = 40;

export async function customerHistories(
  service: Service,
  tenantId: string,
  phones: string[]
): Promise<Map<string, CustomerHistory>> {
  const unique = [...new Set(phones.map((p) => normalizePhone(p)).filter((p) => p.length >= 11))];
  const counts = new Map<string, { livre: number; refus: number }>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await service
      .from('orders')
      .select('customer_whatsapp, delivery_status')
      .eq('user_id', tenantId)
      .is('deleted_at', null)
      .in('customer_whatsapp', chunk.flatMap(phoneVariants))
      .limit(5000);
    if (error) continue; // historique facultatif
    for (const row of (data ?? []) as { customer_whatsapp: string; delivery_status: string }[]) {
      const key = normalizePhone(row.customer_whatsapp);
      const c = counts.get(key) ?? { livre: 0, refus: 0 };
      if (row.delivery_status === 'livre') c.livre++;
      else if (row.delivery_status === 'echec' || row.delivery_status === 'retourne') c.refus++;
      counts.set(key, c);
    }
  }
  const out = new Map<string, CustomerHistory>();
  for (const [phone, c] of counts) out.set(phone, { ...c, level: riskLevel(c.livre, c.refus) });
  return out;
}

/** Nombre de commandes EN ATTENTE par numéro (doublons possibles si > 1). */
export function pendingCountByPhone(
  orders: { phone: string; status: string }[]
): Map<string, number> {
  const pending = new Set(['new', 'confirming', 'no_answer', 'confirmed']);
  const m = new Map<string, number>();
  for (const o of orders) {
    if (!pending.has(o.status)) continue;
    const k = normalizePhone(o.phone);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
