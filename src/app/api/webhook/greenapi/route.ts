import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app';

const STATUS_LABELS = {
  en_preparation: '📦 En préparation', en_transit: '🚚 En transit', en_cours: '🚚 En transit',
  en_livraison: '🛵 En cours de livraison', livre: '✅ Livré avec succès',
  echec: '⚠️ Échec de livraison', retourne: '🔄 Retourné',
};

async function sendReply(phone, message) {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token = process.env.GREENAPI_TOKEN;
  if (!instanceId || !token) return;
  const host = instanceId.slice(0, 4);
  const cleanPhone = phone.replace(/\D/g, '');
  const intlPhone = cleanPhone.startsWith('213') ? cleanPhone : `213${cleanPhone.replace(/^0/, '')}`;
  await fetch(`https://${host}.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: `${intlPhone}@c.us`, message }),
  }).catch(() => {});
}

function extractTracking(text) {
  const match = text.match(/\b(ZR[XEX]?\d+|\d{6,12})\b/i);
  return match ? match[1].toUpperCase() : null;
}

export async function POST(req) {
  try {
    const body = await req.json();
    if (body.typeWebhook !== 'incomingMessageReceived') return NextResponse.json({ ok: true });
    const senderData = body.senderData || {};
    const chatId = senderData.chatId || '';
    const senderName = senderData.senderName || '';
    const text = body.messageData?.textMessageData?.textMessage || body.messageData?.extendedTextMessageData?.text || '';
    if (!chatId || !text.trim()) return NextResponse.json({ ok: true });
    const phone = chatId.replace('@c.us', '').replace('@g.us', '');
    const tracking = extractTracking(text.trim());
    if (!tracking) {
      await sendReply(phone, `Bonjour${senderName ? ` *${senderName}*` : ''} 👋\n\nEnvoyez votre *numéro de tracking*.\nEx : *ZRX123456*\n\n🔗 ${APP_URL}/track`);
      return NextResponse.json({ ok: true });
    }
    const supabase = createServiceClient();
    const { data: order } = await supabase.from('orders')
      .select('tracking_number, customer_name, wilaya, delivery_status, attempts, last_update, product_name')
      .ilike('tracking_number', tracking).limit(1).single();
    if (!order) {
      await sendReply(phone, `❌ Commande *${tracking}* introuvable. Vérifiez et réessayez.`);
      return NextResponse.json({ ok: true });
    }
    const statusLabel = STATUS_LABELS[order.delivery_status] || order.delivery_status;
    let reply = `📦 *Commande ${order.tracking_number}*\n\n`;
    reply += `👤 Client : ${order.customer_name || '—'}\n`;
    if (order.wilaya) reply += `📍 Wilaya : ${order.wilaya}\n`;
    if (order.product_name) reply += `🛍️ Produit : ${order.product_name}\n`;
    reply += `📊 Statut : *${statusLabel}*\n`;
    if (order.attempts) reply += `🔁 Tentatives : ${order.attempts}\n`;
    reply += `\n🔗 ${APP_URL}/track/${order.tracking_number}`;
    if (order.delivery_status === 'echec') reply += `\n\n⚠️ Livreur non joignable. Contactez votre vendeur.`;
    else if (order.delivery_status === 'livre') reply += `\n\n🎉 Merci pour votre confiance !`;
    await sendReply(phone, reply);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: true }); }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'ZREXtrack WhatsApp Bot' });
}
