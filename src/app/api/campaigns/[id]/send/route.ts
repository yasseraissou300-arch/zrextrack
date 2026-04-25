import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '213' + digits.slice(1);
  return digits + '@c.us';
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function guessFileName(url: string): string {
  try { return new URL(url).pathname.split('/').pop() || 'file'; } catch { return 'file'; }
}

async function sendText(instanceId: string, token: string, chatId: string, message: string) {
  const res = await fetch(
    `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, message }) }
  );
  return res.json();
}

async function sendFile(instanceId: string, token: string, chatId: string, urlFile: string, fileName: string, caption: string) {
  const res = await fetch(
    `https://api.green-api.com/waInstance${instanceId}/sendFileByUrl/${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, urlFile, fileName, caption }) }
  );
  return res.json();
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();

  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (cErr || !campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });
  if (campaign.status === 'en_cours') return NextResponse.json({ error: 'Campagne déjà en cours' }, { status: 400 });

  const { data: settings } = await supabase
    .from('whatsapp_settings')
    .select('instance_id, api_token')
    .eq('user_id', user.id)
    .single();

  if (!settings?.instance_id || !settings?.api_token) {
    return NextResponse.json({ error: 'WhatsApp non configuré' }, { status: 400 });
  }

  let ordersQuery = supabase
    .from('orders')
    .select('id, tracking_number, customer_name, customer_whatsapp, wilaya, cod')
    .eq('user_id', user.id)
    .not('customer_whatsapp', 'is', null)
    .neq('customer_whatsapp', '');

  if (campaign.audience_status) {
    ordersQuery = ordersQuery.eq('delivery_status', campaign.audience_status);
  }

  const { data: orders } = await ordersQuery;
  const validOrders = (orders || []).filter(o => o.customer_whatsapp && o.customer_whatsapp.length > 5);

  await supabase
    .from('campaigns')
    .update({ status: 'en_cours', total_count: validOrders.length, updated_at: new Date().toISOString() })
    .eq('id', id);

  let sent = 0;
  let failed = 0;
  const mediaUrl: string = campaign.media_url || '';
  const fileName = mediaUrl ? guessFileName(mediaUrl) : '';

  for (const order of validOrders) {
    const message = interpolate(campaign.message_template, {
      client: order.customer_name || '',
      tracking: order.tracking_number || '',
      wilaya: order.wilaya || '',
      cod: String(order.cod ?? ''),
    });

    const chatId = formatPhone(order.customer_whatsapp);
    let status: 'envoye' | 'echec' = 'echec';

    try {
      let json: any;
      if (mediaUrl) {
        json = await sendFile(settings.instance_id, settings.api_token, chatId, mediaUrl, fileName, message);
      } else {
        json = await sendText(settings.instance_id, settings.api_token, chatId, message);
      }
      status = json.idMessage ? 'envoye' : 'echec';
    } catch {}

    if (status === 'envoye') sent++; else failed++;

    await supabase.from('campaign_recipients').insert({
      campaign_id: id,
      client: order.customer_name || '',
      phone: order.customer_whatsapp,
      tracking: order.tracking_number || '',
      message,
      status,
      sent_at: new Date().toISOString(),
    });
  }

  await supabase
    .from('campaigns')
    .update({ status: 'termine', sent_count: sent, failed_count: failed, updated_at: new Date().toISOString() })
    .eq('id', id);

  return NextResponse.json({ sent, failed, total: validOrders.length });
}
