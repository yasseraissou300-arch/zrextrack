// Envoi WhatsApp pour les commandes à confirmer : MÊME numéro Evolution, MÊME
// plafond journalier (warm-up compris) et MÊME disjoncteur que les
// notifications de livraison. Aucun envoi au-delà du plafond.

import type { createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';
import { ownedInstance } from '@/lib/whatsapp/instance-ownership';
import { remainingDailyQuota } from '@/lib/whatsapp/anti-spam';
import { circuitState } from '@/lib/queue/circuit-breaker';
import { getTenantSettings } from '@/lib/queue/repository';
import type { ConfirmOrder, SendText } from '@/lib/inbox/confirm';

type Service = ReturnType<typeof createServiceClient>;

export interface WaSender {
  send: SendText;
  /** Messages encore autorisés aujourd'hui. */
  remaining: number;
  logSent: (o: Pick<ConfirmOrder, 'id' | 'customer_name' | 'phone'>, text: string) => Promise<void>;
}

export type SenderUnavailable = 'not_connected' | 'circuit_open';

/** Envoi d'un texte par l'instance Evolution du marchand. */
export async function evolutionSendText(
  url: string,
  key: string,
  instance: string,
  phone: string,
  text: string
): Promise<boolean> {
  try {
    const r = await fetch(`${url}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ number: phone, text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Journal `messages` : c'est lui qui sert de compteur au plafond journalier. */
export async function logWaMessage(
  service: Service,
  tenantId: string,
  ref: string,
  name: string,
  phone: string,
  text: string
): Promise<void> {
  await service.from('messages').insert({
    user_id: tenantId,
    tracking_number: ref,
    customer_name: name || '',
    customer_whatsapp: phone,
    message: text,
    status: 'envoye',
    sent_at: new Date().toISOString(),
  });
}

export async function getWaSender(
  service: Service,
  tenantId: string
): Promise<WaSender | SenderUnavailable> {
  const settings = await getTenantSettings(service, tenantId).catch(() => null);
  if (circuitState(settings).open) return 'circuit_open';

  const ev = await resolveEvolutionCreds(tenantId);
  if (!ev.url || !ev.key) return 'not_connected';
  const { data: instRow } = await service
    .from('whatsapp_instances')
    .select('instance_name')
    .eq('user_id', tenantId)
    .eq('service_type', 'auto_confirmation')
    .maybeSingle();
  const inst = ownedInstance(tenantId, instRow, 'inbox.confirm');
  if (!inst?.instance_name) return 'not_connected';

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [{ count }, { data: prof }] = await Promise.all([
    service
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', tenantId)
      .eq('status', 'envoye')
      .gte('sent_at', since),
    service.from('profiles').select('whatsapp_warmup_started_at').eq('id', tenantId).maybeSingle(),
  ]);
  const warmup =
    (prof as { whatsapp_warmup_started_at?: string | null } | null)?.whatsapp_warmup_started_at ??
    null;

  return {
    remaining: remainingDailyQuota(count ?? 0, warmup),
    send: (phone, text) => evolutionSendText(ev.url!, ev.key!, inst.instance_name!, phone, text),
    logSent: (o, text) =>
      logWaMessage(service, tenantId, `CONF-${o.id.slice(0, 8)}`, o.customer_name, o.phone, text),
  };
}
