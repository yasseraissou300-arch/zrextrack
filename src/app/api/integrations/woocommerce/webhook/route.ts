import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verifyHmacSha256Base64 } from '@/lib/security/webhook-hmac';
import { hasSeenDurable, recordSeenDurable } from '@/lib/security/replay-store';
import { openIntegrationSecret } from '@/lib/security/stored-secrets';
import { logEvent } from '@/lib/security/safe-log';

function mapWooStatus(status: string): string {
  const map: Record<string, string> = {
    pending: 'en_preparation',
    processing: 'en_preparation',
    'on-hold': 'en_preparation',
    completed: 'livre',
    cancelled: 'retourne',
    refunded: 'retourne',
    failed: 'echec',
    shipped: 'en_transit',
    'out-for-delivery': 'en_livraison',
  };
  return map[status] || 'en_preparation';
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-wc-webhook-signature') || '';
    const source = request.headers.get('x-wc-webhook-source') || '';
    const topic = request.headers.get('x-wc-webhook-topic') || '';

    const supabase = createServiceClient();

    const { data: integration } = await supabase
      .from('integrations')
      .select('user_id, secret_key')
      .eq('platform', 'woocommerce')
      .eq('identifier', source)
      .eq('active', true)
      .single();

    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    }

    // Signature OBLIGATOIRE (fail-closed) : un secret vide ne désactive plus la
    // vérification. Aucune écriture avant ce point.
    const check = verifyHmacSha256Base64(
      rawBody,
      signature,
      // Déchiffré côté serveur ; illisible → null → refus (fail-closed).
      openIntegrationSecret(integration.user_id, 'woocommerce', integration.secret_key)
    );
    if (!check.ok) {
      logEvent('warn', 'webhook.woocommerce', { status: 'rejected', reason: check.reason });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Anti-rejeu DURABLE « au moins une fois » : vérifié ici, enregistré après
    // succès (un échec n'enregistre rien → le fournisseur réessaie, rien n'est
    // perdu ; l'upsert reste idempotent pour les livraisons concurrentes).
    const deliveryId = request.headers.get('x-wc-webhook-delivery-id') || '';
    const replayKey = deliveryId ? `woocommerce:${integration.user_id}:${deliveryId}` : '';
    if (replayKey && (await hasSeenDurable(supabase, replayKey))) {
      logEvent('info', 'webhook.woocommerce', { status: 'skipped_replay' });
      return NextResponse.json({ ok: true, deduped: true });
    }

    const order = JSON.parse(rawBody);

    if (!topic.startsWith('order.')) {
      return NextResponse.json({ ok: true });
    }

    const phone: string = order.billing?.phone || order.shipping?.phone || '';
    const tracking: string = `WOO-${order.number || order.id}`;
    const status = mapWooStatus(order.status);

    const { error: writeError } = await supabase.from('orders').upsert(
      {
        user_id: integration.user_id,
        tracking_number: tracking,
        customer_name:
          `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() ||
          order.billing?.email ||
          'Client',
        customer_whatsapp: phone,
        product_name: order.line_items?.[0]?.name || '',
        wilaya: order.shipping?.city || order.billing?.city || '',
        cod: order.total ? parseFloat(order.total) : 0,
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
      logEvent('error', 'webhook.woocommerce', {
        status: 'write_failed',
        error_code: writeError.code,
      });
      return NextResponse.json({ error: 'Write failed' }, { status: 500 });
    }

    await recordSeenDurable(supabase, replayKey);
    return NextResponse.json({ ok: true });
  } catch {
    // Jamais « ok » sur une erreur : la commande n'a pas été enregistrée.
    logEvent('error', 'webhook.woocommerce', { status: 'unexpected' });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
