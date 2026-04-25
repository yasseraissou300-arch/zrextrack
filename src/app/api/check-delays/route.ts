import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app';
const THRESHOLDS = { en_preparation: 24, en_transit: 72, en_livraison: 48 };

async function sendWA(phone, message) {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token = process.env.GREENAPI_TOKEN;
  if (!instanceId || !token) return false;
  try {
    const host = instanceId.slice(0, 4);
    const clean = phone.replace(/\D/g, '');
    if (!clean || clean.length < 9) return false;
    const intl = clean.startsWith('213') ? clean : `213${clean.replace(/^0/, '')}`;
    const res = await fetch(`https://${host}.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: `${intl}@c.us`, message }) });
    return res.ok;
  } catch { return false; }
}

export async function POST(_req) {
  try {
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const supabase = createServiceClient();
    const now = new Date();
    const alerts = [];
    for (const [status, hours] of Object.entries(THRESHOLDS)) {
      const cutoff = new Date(now - hours * 3600000);
      const { data } = await supabase.from('orders').select('tracking_number,customer_name,customer_whatsapp,last_update')
        .eq('delivery_status', status).lt('last_update', cutoff.toISOString()).not('customer_whatsapp','is',null).neq('customer_whatsapp','');
      for (const o of data || []) {
        const h = Math.round((now - new Date(o.last_update)) / 3600000);
        const labels = { en_preparation: 'en préparation', en_transit: 'en transit', en_livraison: 'en cours de livraison' };
        const msg = `⏰ Bonjour${o.customer_name ? ` *${o.customer_name}*` : ''}, votre commande *${o.tracking_number}* est ${labels[status]} depuis *${h}h*.\n\nNotre équipe s'en occupe.\n\n🔗 ${APP_URL}/track/${o.tracking_number}`;
        const sent = await sendWA(o.customer_whatsapp, msg);
        await supabase.from('messages').insert({ customer_name: o.customer_name, customer_whatsapp: o.customer_whatsapp, tracking_number: o.tracking_number, message: msg, status: sent ? 'envoye' : 'echec', sent_at: new Date().toISOString(), user_id: user.id }).then(() => {});
        alerts.push({ tracking_number: o.tracking_number, delivery_status: status, hours: h, notified: sent });
      }
    }
    return NextResponse.json({ alerts: alerts.length, notified: alerts.filter(a => a.notified).length });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
