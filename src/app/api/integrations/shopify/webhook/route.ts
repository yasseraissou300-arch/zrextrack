import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

function verifyShopifyHmac(body: string, hmacHeader: string, secret: string): boolean {
  const digest = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  return digest === hmacHeader;
}

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

    // Verify webhook signature
    if (integration.secret_key && !verifyShopifyHmac(rawBody, hmac, integration.secret_key)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const order = JSON.parse(rawBody);

    if (!['orders/create', 'orders/updated', 'orders/fulfilled'].includes(topic)) {
      return NextResponse.json({ ok: true });
    }

    const phone: string = order.shipping_address?.phone || order.billing_address?.phone || order.phone || '';
    const tracking: string = order.name?.replace('#', 'SHO-') || `SHO-${order.id}`;
    const status = mapShopifyStatus(order.fulfillment_status, order.financial_status);

    await supabase.from('orders').upsert(
      {
        user_id: integration.user_id,
        tracking_number: tracking,
        customer_name: `${order.shipping_address?.first_name || ''} ${order.shipping_address?.last_name || ''}`.trim() || order.email || 'Client',
        customer_whatsapp: phone,
        product_name: order.line_items?.[0]?.name || '',
        wilaya: order.shipping_address?.city || '',
        cod: order.total_price ? parseFloat(order.total_price) : 0,
        delivery_status: status,
        last_update: new Date().toISOString(),
      },
      { onConflict: 'tracking_number' }
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
