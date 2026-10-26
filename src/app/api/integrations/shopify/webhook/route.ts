import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verifyHmacSha256Base64 } from '@/lib/security/webhook-hmac';
import { hasSeenDurable, isStaleEvent, recordSeenDurable } from '@/lib/security/replay-store';
import { openIntegrationSecret } from '@/lib/security/stored-secrets';
import { logEvent } from '@/lib/security/safe-log';

function mapShopifyStatus(fulfillmentStatus: string | null, financialStatus: string): string {
  if (financialStatus === 'refunded') return 'retourne';
  if (!fulfillmentStatus) return 'en_preparation';
  const map: Record<string, string> = {
    fulfilled: 'livre',
    partial: 'en_livraison',
    restocked: 'retourne',
  };
  return map[fulfillmentStatus] || 'en_transit';
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const hmac = request.headers.get('x-shopify-hmac-sha256') || '';
    const shopDomain = request.headers.get('x-shopify-shop-domain') || '';
    const topic = request.headers.get('x-shopify-topic') || '';

    const supabase = createServiceClient();

    // Find integration by shop domain
    const { data: integration } = await supabase
      .from('integrations')
      .select('user_id, secret_key')
      .eq('platform', 'shopify')
      .eq('identifier', shopDomain)
      .eq('active', true)
      .single();

    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    }

    // Signature OBLIGATOIRE (fail-closed) : un secret vide ne désactive plus la
    // vérification. Aucune écriture avant ce point.
    const check = verifyHmacSha256Base64(
      rawBody,
      hmac,
      // Déchiffré côté serveur ; illisible → null → refus (fail-closed).
      openIntegrationSecret(integration.user_id, 'shopify', integration.secret_key)
    );
    if (!check.ok) {
      logEvent('warn', 'webhook.shopify', { status: 'rejected', reason: check.reason });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Anti-rejeu DURABLE « au moins une fois » : vérifié ici, enregistré après
    // succès (un échec n'enregistre rien → le fournisseur réessaie, rien n'est
    // perdu ; l'upsert reste idempotent pour les livraisons concurrentes).
    const triggeredAt = request.headers.get('x-shopify-triggered-at');
    if (triggeredAt && isStaleEvent(Date.parse(triggeredAt) / 1000)) {
      logEvent('info', 'webhook.shopify', { status: 'skipped_stale' });
      return NextResponse.json({ ok: true, stale: true });
    }
    const deliveryId = request.headers.get('x-shopify-webhook-id') || '';
    const replayKey = deliveryId ? `shopify:${integration.user_id}:${deliveryId}` : '';
    if (replayKey && (await hasSeenDurable(supabase, replayKey))) {
      logEvent('info', 'webhook.shopify', { status: 'skipped_replay' });
      return NextResponse.json({ ok: true, deduped: true });
    }

    const order = JSON.parse(rawBody);

    if (!['orders/create', 'orders/updated', 'orders/fulfilled'].includes(topic)) {
      return NextResponse.json({ ok: true });
    }

    const phone: string =
      order.shipping_address?.phone || order.billing_address?.phone || order.phone || '';
    const tracking: string = order.name?.replace('#', 'SHO-') || `SHO-${order.id}`;
    const status = mapShopifyStatus(order.fulfillment_status, order.financial_status);

    const { error: writeError } = await supabase.from('orders').upsert(
      {
        user_id: integration.user_id,
        tracking_number: tracking,
        customer_name:
          `${order.shipping_address?.first_name || ''} ${order.shipping_address?.last_name || ''}`.trim() ||
          order.email ||
          'Client',
        customer_whatsapp: phone,
        product_name: order.line_items?.[0]?.name || '',
        wilaya: order.shipping_address?.city || '',
        cod: order.total_price ? parseFloat(order.total_price) : 0,
        delivery_status: status,
        last_update: new Date().toISOString(),
      },
      // Unicité PAR TENANT (même clé que le sync ZR) : 'tracking_number' seul
      // échouait si seule la contrainte composite existe (commande perdue en
      // silence) ou écrasait la commande d'un autre tenant de même numéro.
      { onConflict: 'user_id,tracking_number' }
    );
    if (writeError) {
      // 500 → le fournisseur réessaie ; rien n'est marqué « vu ».
      logEvent('error', 'webhook.shopify', { status: 'write_failed', error_code: writeError.code });
      return NextResponse.json({ error: 'Write failed' }, { status: 500 });
    }

    await recordSeenDurable(supabase, replayKey);
    return NextResponse.json({ ok: true });
  } catch {
    // Jamais « ok » sur une erreur : la commande n'a pas été enregistrée.
    logEvent('error', 'webhook.shopify', { status: 'unexpected' });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
