// Handler `campaign.dispatch` — enfourne les destinataires d'une campagne
// par lots, avec curseur.
//
// PROBLÈME RÉSOLU : la route actuelle boucle sur N destinataires avec
// sleep(20-60 s) dans une seule requête HTTP. Elle déclare maxDuration = 300
// alors que Vercel Hobby plafonne à 60 s → la campagne meurt après ~2 envois.
//
// Ici le job enfourne un lot borné puis SE RÉ-ENFILE avec le curseur avancé.
// Aucune requête longue, campagne reprenable, arrêtable et observable.

import { createServiceClient } from '@/lib/supabase/server';
import { randomThrottle } from '@/lib/whatsapp/anti-spam';
import { logEvent } from '@/lib/security/safe-log';
import { enqueue } from '../repository';
import { campaignRecipientKey, campaignDispatchKey } from '../idempotency';
import type { Job, HandlerResult, CampaignDispatchPayload, WhatsAppSendPayload } from '../types';

/** Destinataires enfilés par lot. Borné pour rester loin du budget du tick. */
const BATCH_SIZE = 25;

export async function handleCampaignDispatch(job: Job): Promise<HandlerResult> {
  const supabase = createServiceClient();
  const tenantId = job.tenant_id;
  const payload = job.payload as unknown as CampaignDispatchPayload;

  if (!payload?.campaign_id) {
    return { outcome: 'failed', error: 'campaign_id manquant' };
  }
  const offset = Number(payload.offset ?? 0);

  // ── 1. Campagne — scopée au tenant ────────────────────────────────────────
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', payload.campaign_id)
    .eq('user_id', tenantId) // scoping tenant explicite
    .maybeSingle();

  if (cErr) return { outcome: 'failed', error: `lecture campagne: ${cErr.message}` };
  if (!campaign) return { outcome: 'failed', error: 'campagne introuvable pour ce tenant' };

  // Campagne arrêtée entre-temps : on s'arrête proprement, sans erreur.
  if (campaign.status === 'termine' || campaign.status === 'annule') {
    logEvent('info', 'queue.campaign', {
      tenant_id: tenantId,
      conversation_id: payload.campaign_id,
      status: 'stopped_by_user',
    });
    return { outcome: 'done' };
  }

  // ── 2. Audience ───────────────────────────────────────────────────────────
  const audience = await loadAudience(supabase, tenantId, campaign, offset, BATCH_SIZE);

  if (audience.length === 0) {
    await supabase
      .from('campaigns')
      .update({ status: 'termine', updated_at: new Date().toISOString() })
      .eq('id', payload.campaign_id)
      .eq('user_id', tenantId);

    logEvent('info', 'queue.campaign', {
      tenant_id: tenantId,
      conversation_id: payload.campaign_id,
      status: 'completed',
      total: offset,
    });
    return { outcome: 'done' };
  }

  // ── 3. Enfilement des envois, espacés ─────────────────────────────────────
  const mediaUrl: string = campaign.media_url || '';
  let delay = 10_000;
  let enqueued = 0;

  for (const r of audience) {
    const message = interpolate(campaign.message_template ?? '', {
      client: r.customer_name || '',
      tracking: r.tracking_number || '',
      wilaya: r.wilaya || '',
      produit: r.product_name || '',
      cod: String(r.cod ?? ''),
    });

    const p: WhatsAppSendPayload = {
      campaign_id: payload.campaign_id,
      phone: r.customer_whatsapp,
      message,
      tracking_number: r.tracking_number || '',
      customer_name: r.customer_name || '',
      ...(mediaUrl ? { media_url: mediaUrl } : {}),
    };

    const created = await enqueue(supabase, {
      tenantId,
      type: 'whatsapp.send',
      payload: p as unknown as Record<string, unknown>,
      runAfter: new Date(Date.now() + delay),
      idempotencyKey: campaignRecipientKey(payload.campaign_id, r.customer_whatsapp),
    });

    if (created) enqueued++;
    delay += randomThrottle(); // 20-60 s — throttle anti-ban inchangé
  }

  // ── 4. Curseur : se ré-enfiler pour le lot suivant ────────────────────────
  const nextOffset = offset + audience.length;
  await enqueue(supabase, {
    tenantId,
    type: 'campaign.dispatch',
    payload: { campaign_id: payload.campaign_id, offset: nextOffset },
    // Le lot suivant part après l'écoulement de celui-ci, pour ne pas
    // accumuler des milliers de jobs en attente d'un coup.
    runAfter: new Date(Date.now() + delay),
    idempotencyKey: campaignDispatchKey(payload.campaign_id, nextOffset),
  });

  logEvent('info', 'queue.campaign', {
    tenant_id: tenantId,
    conversation_id: payload.campaign_id,
    status: 'batch_enqueued',
    enqueued,
    offset,
  });

  return { outcome: 'done' };
}

interface Recipient {
  customer_whatsapp: string;
  customer_name: string | null;
  tracking_number: string | null;
  wilaya: string | null;
  product_name: string | null;
  cod: number | null;
}

/**
 * Charge un lot de destinataires.
 *
 * Deux modes, repris de la route existante :
 *   - liste personnalisée (`audience_phones`)
 *   - filtre par statut de livraison
 *
 * NOTE : la route actuelle sélectionne `updated_at` sur `orders` — colonne qui
 * N'EXISTE PAS (vérifié par introspection). On trie ici sur `last_update`, qui
 * existe bien. Voir BUG-11 du rapport Phase 0.
 */
async function loadAudience(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  campaign: Record<string, any>,
  offset: number,
  limit: number
): Promise<Recipient[]> {
  const custom = (campaign.audience_phones as string[] | null) ?? null;

  if (custom && custom.length > 0) {
    const slice = custom.slice(offset, offset + limit);
    if (slice.length === 0) return [];

    const { data: known } = await supabase
      .from('orders')
      .select(
        'tracking_number, customer_name, customer_whatsapp, wilaya, product_name, cod, last_update'
      )
      .eq('user_id', tenantId)
      .in('customer_whatsapp', slice)
      .order('last_update', { ascending: false });

    const byPhone = new Map<string, Recipient>();
    for (const o of (known as Recipient[] | null) ?? []) {
      if (!byPhone.has(o.customer_whatsapp)) byPhone.set(o.customer_whatsapp, o);
    }

    return slice.map((phone) => {
      const k = byPhone.get(phone);
      return {
        customer_whatsapp: phone,
        customer_name: k?.customer_name ?? '',
        tracking_number: k?.tracking_number ?? '',
        wilaya: k?.wilaya ?? '',
        product_name: k?.product_name ?? '',
        cod: k?.cod ?? null,
      };
    });
  }

  let q = supabase
    .from('orders')
    .select('tracking_number, customer_name, customer_whatsapp, wilaya, product_name, cod')
    .eq('user_id', tenantId)
    .not('customer_whatsapp', 'is', null)
    .neq('customer_whatsapp', '')
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (campaign.audience_status) q = q.eq('delivery_status', campaign.audience_status);

  const { data } = await q;
  return ((data as Recipient[] | null) ?? []).filter(
    (o) => o.customer_whatsapp && o.customer_whatsapp.length > 5
  );
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
