// Notification de livraison par l'API officielle depuis la file autotim
// (chemin « serveur ») : le job ne porte que le texte, on relit la commande
// pour les variables du modèle (produit, montant) et le bureau stop desk.

import type { createServiceClient } from '@/lib/supabase/server';
import type { WhatsAppSendPayload } from '@/lib/queue/types';
import { getZrCredentials } from '@/lib/zrexpress/credentials';
import { findParcelHub, officeText, STOPDESK_STATUSES } from '@/lib/zrexpress/stopdesk';
import {
  sendCloudTemplate,
  TEMPLATES,
  type CloudConfig,
  type CloudSendResult,
  type CloudTemplateKind,
} from '@/lib/whatsapp/cloud';

type Service = ReturnType<typeof createServiceClient>;

export async function sendCloudNotification(
  service: Service,
  cfg: CloudConfig,
  tenantId: string,
  phone: string,
  payload: WhatsAppSendPayload
): Promise<CloudSendResult> {
  const status = String(payload.delivery_status ?? '');
  if (!(status in TEMPLATES) || status === 'confirm') {
    return { ok: false, status: 0, error: `aucun modèle pour « ${status} »` };
  }
  const tracking = payload.tracking_number ?? '';
  const { data } = await service
    .from('orders')
    .select('customer_name, product_name, cod')
    .eq('user_id', tenantId)
    .eq('tracking_number', tracking)
    .maybeSingle();
  const o = (data ?? {}) as { customer_name?: string; product_name?: string; cod?: number };

  let livraison = 'للدار';
  if (STOPDESK_STATUSES.has(status)) {
    const zr = await getZrCredentials(service, tenantId).catch(() => null);
    const hub = zr ? await findParcelHub(zr, tracking) : null;
    if (hub) livraison = officeText(hub);
  }

  return sendCloudTemplate(cfg, phone, status as CloudTemplateKind, {
    client: o.customer_name || payload.customer_name || '',
    produit: o.product_name || '',
    tracking,
    cod: o.cod ?? 0,
    livraison,
  });
}
