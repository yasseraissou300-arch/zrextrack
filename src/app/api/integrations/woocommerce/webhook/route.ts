import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

function verifyWooSignature(body: string, signatureHeader: string, secret: string): boolean {
  const digest = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  return digest === signatureHeader;
}

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

    if (integration.secret_key && !verifyWooSignature(rawBody, signature, integration.secret_key)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const order = JSON.parse(rawBody);

    if (!topic.startsWith('order.')) {
      return NextResponse.json({ ok: true });
    }

    const phone: string = order.billing?.phone || order.shipping?.phone || '';
    const tracking: string = `WOO-${order.number || order.id}`;
    const status = mapWooStatus(order.status);

    await supabase.from('orders').upsert(
      {
        user_id: integration.user_id,
        tracking,
        client: `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || order.billing?.email || 'Client',
        whatsapp: phone,
        product: order.line_items?.[0]?.name || '',
        wilaya: order.shipping?.city || order.billing?.city || '',
        cod: order.total ? parseFloat(order.total) : 0,
        status,
        last_update: new Date().toISOString(),
      },
      { onConflict: 'tracking' }
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
