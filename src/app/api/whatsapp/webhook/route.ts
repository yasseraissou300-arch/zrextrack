import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.netlify.app';

const STATUS_LABELS: Record<string, string> = {
  en_preparation: '📦 En préparation',
  en_transit: '🚚 En transit',
  en_livraison: '🛵 En cours de livraison',
  livre: '✅ Livré',
  echec: '⚠️ Échec de livraison',
  retourne: '🔄 Retourné',
};

const DEFAULT_PROMPTS: Record<string, string> = {
  darija: `Nta assistant livraison dial ZREXpress f l'Algérie. Jaweb 3la les clients bDarija Algérienne — mzyan, wjiz, w rassurant.
- Waqt livraison: 24 l 72 sa3a
- F cas problème: 9ol l client ibayno raqm tracking dyalo
- F cas retour: i9dir ikhalti ma3a l livreur wla i9bir l support
IMPORTANT: Jaweb DIMA bDarija Algérienne. Wjiz — maximum 2-3 jmla.`,
  arabic: `أنت مساعد توصيل لشركة ZREXpress في الجزائر. أجب على العملاء باللغة العربية الفصحى — بشكل واضح ومريح.
- وقت التوصيل: 24 إلى 72 ساعة
- في حالة المشكلة: اطلب رقم التتبع
- في حالة الإرجاع: تواصل مع السائق أو الدعم
مهم: أجب دائماً بالعربية. اختصر — جملتان أو ثلاث فقط.`,
  french: `Tu es l'assistant livraison de ZREXpress en Algérie. Réponds aux clients en français — clair, bref et rassurant.
- Délai de livraison: 24 à 72h
- En cas de problème: demande le numéro de tracking
- En cas de retour: contacter le livreur ou le support
IMPORTANT: Réponds TOUJOURS en français. Maximum 2-3 phrases.`,
};

function extractTracking(text: string): string | null {
  const match = text.match(/\b(ZR[XE]?\d{4,}|\d{8,12})\b/i);
  return match ? match[1].toUpperCase() : null;
}

async function sendWhatsApp(instanceId: string, token: string, chatId: string, message: string) {
  try {
    await fetch(
      `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message }),
      }
    );
  } catch {}
}

async function callGemini(prompt: string, userMessage: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt}\n\nClient: ${userMessage}` }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
        }),
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.typeWebhook !== 'incomingMessageReceived') {
      return NextResponse.json({ ok: true });
    }

    const msgType = body.messageData?.typeMessage;
    if (msgType !== 'textMessage' && msgType !== 'extendedTextMessage') {
      return NextResponse.json({ ok: true });
    }

    const text: string =
      body.messageData?.textMessageData?.textMessage ||
      body.messageData?.extendedTextMessageData?.text || '';
    const chatId: string = body.senderData?.chatId || '';
    const senderName: string = body.senderData?.senderName || '';
    const instanceId: string = body.instanceData?.idInstance?.toString() || '';

    if (!text.trim() || !chatId || chatId.includes('@g.us')) {
      return NextResponse.json({ ok: true });
    }

    const supabase = createServiceClient();

    // Find the user who owns this Green API instance
    const { data: waSettings } = await supabase
      .from('whatsapp_settings')
      .select('user_id, instance_id, api_token')
      .eq('instance_id', instanceId)
      .single();

    if (!waSettings) {
      // Fallback: use env vars for single-instance deployments
      const envInstance = process.env.GREEN_API_INSTANCE_ID || process.env.GREENAPI_INSTANCE_ID;
      const envToken = process.env.GREEN_API_TOKEN || process.env.GREENAPI_TOKEN;
      if (!envInstance || !envToken) return NextResponse.json({ ok: true });

      const tracking = extractTracking(text);
      if (tracking) {
        const { data: order } = await supabase
          .from('orders')
          .select('tracking_number, customer_name, wilaya, delivery_status, attempts, product_name')
          .ilike('tracking_number', tracking)
          .limit(1)
          .single();

        if (order) {
          const reply = buildTrackingReply(order);
          await sendWhatsApp(envInstance, envToken, chatId, reply);
        } else {
          await sendWhatsApp(envInstance, envToken, chatId, `❌ Commande *${tracking}* introuvable. Vérifiez le numéro et réessayez.`);
        }
      } else {
        await sendWhatsApp(envInstance, envToken, chatId,
          `Bonjour${senderName ? ` *${senderName}*` : ''} 👋\nEnvoyez votre *numéro de tracking* pour suivre votre commande.\nEx: *ZRX123456*`);
      }
      return NextResponse.json({ ok: true });
    }

    const { user_id, instance_id, api_token } = waSettings;

    // Increment messages_received counter
    await supabase.rpc('increment_bot_stat', { p_user_id: user_id, p_field: 'messages_received' }).catch(() => {
      supabase.from('bot_settings').upsert(
        { user_id, messages_received: 1, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    });

    const { data: botSettings } = await supabase
      .from('bot_settings')
      .select('ai_enabled, language, system_prompt')
      .eq('user_id', user_id)
      .single();

    const aiEnabled = botSettings?.ai_enabled ?? true;
    const language = botSettings?.language ?? 'darija';
    const customPrompt = botSettings?.system_prompt?.trim() || '';
    const systemPrompt = customPrompt || DEFAULT_PROMPTS[language] || DEFAULT_PROMPTS.darija;

    // 1. Try tracking lookup first
    const tracking = extractTracking(text);
    if (tracking) {
      const { data: order } = await supabase
        .from('orders')
        .select('tracking_number, customer_name, wilaya, delivery_status, attempts, product_name')
        .eq('user_id', user_id)
        .ilike('tracking_number', tracking)
        .limit(1)
        .single();

      if (order) {
        const reply = buildTrackingReply(order);
        await sendWhatsApp(instance_id, api_token, chatId, reply);
        await supabase.from('bot_settings')
          .upsert({ user_id, tracking_replies_sent: (botSettings as any)?.tracking_replies_sent + 1 || 1, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        return NextResponse.json({ ok: true });
      }

      await sendWhatsApp(instance_id, api_token, chatId, `❌ Commande *${tracking}* introuvable. Vérifiez le numéro et réessayez.`);
      return NextResponse.json({ ok: true });
    }

    // 2. No tracking — use AI if enabled
    if (aiEnabled) {
      const aiReply = await callGemini(systemPrompt, text);
      if (aiReply) {
        await sendWhatsApp(instance_id, api_token, chatId, aiReply);
        await supabase.from('bot_settings')
          .upsert({ user_id, ai_replies_sent: (botSettings as any)?.ai_replies_sent + 1 || 1, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        return NextResponse.json({ ok: true });
      }
    }

    // 3. Fallback — ask for tracking number
    const fallback = language === 'french'
      ? `Bonjour${senderName ? ` *${senderName}*` : ''} 👋\nEnvoyez votre *numéro de tracking* pour suivre votre commande.\n🔗 ${APP_URL}/track`
      : language === 'arabic'
      ? `أهلاً${senderName ? ` *${senderName}*` : ''} 👋\nأرسل *رقم التتبع* الخاص بك لتتبع طلبك.`
      : `السلام عليكم${senderName ? ` *${senderName}*` : ''} 👋\nبعث لينا *رقم التتبع* ديالك باش نتبعو طردك.\nمثلاً: *ZRX123456*`;

    await sendWhatsApp(instance_id, api_token, chatId, fallback);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}

function buildTrackingReply(order: any): string {
  const statusLabel = STATUS_LABELS[order.delivery_status] || order.delivery_status;
  let reply = `📦 *Commande ${order.tracking_number}*\n\n`;
  reply += `👤 ${order.customer_name || '—'}\n`;
  if (order.wilaya) reply += `📍 ${order.wilaya}\n`;
  if (order.product_name) reply += `🛍️ ${order.product_name}\n`;
  reply += `📊 *${statusLabel}*`;
  if (order.attempts) reply += `\n🔁 Tentatives : ${order.attempts}`;
  if (order.delivery_status === 'echec') reply += `\n\n⚠️ Livreur non joignable. Contactez votre vendeur.`;
  else if (order.delivery_status === 'livre') reply += `\n\n🎉 Merci pour votre confiance !`;
  return reply;
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'ZREXtrack WhatsApp Bot v2' });
}
