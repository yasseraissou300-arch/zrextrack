import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

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

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { message } = await request.json();
  if (!message?.trim()) return NextResponse.json({ error: 'Message requis' }, { status: 400 });

  const supabase = createServiceClient();

  const { data: botSettings } = await supabase
    .from('bot_settings')
    .select('ai_enabled, language, system_prompt')
    .eq('user_id', user.id)
    .single();

  const aiEnabled = botSettings?.ai_enabled ?? true;
  const language = botSettings?.language ?? 'darija';
  const systemPrompt = botSettings?.system_prompt?.trim() || DEFAULT_PROMPTS[language] || DEFAULT_PROMPTS.darija;

  // 1. Check for tracking number
  const tracking = extractTracking(message.trim());
  if (tracking) {
    const { data: order } = await supabase
      .from('orders')
      .select('tracking_number, customer_name, wilaya, delivery_status, attempts, product_name')
      .eq('user_id', user.id)
      .ilike('tracking_number', tracking)
      .limit(1)
      .single();

    if (order) {
      const statusLabel = STATUS_LABELS[order.delivery_status] || order.delivery_status;
      let reply = `📦 *Commande ${order.tracking_number}*\n\n`;
      reply += `👤 ${order.customer_name || '—'}\n`;
      if (order.wilaya) reply += `📍 ${order.wilaya}\n`;
      if (order.product_name) reply += `🛍️ ${order.product_name}\n`;
      reply += `📊 *${statusLabel}*`;
      if (order.attempts) reply += `\n🔁 Tentatives : ${order.attempts}`;
      if (order.delivery_status === 'echec') reply += `\n\n⚠️ Livreur non joignable. Contactez votre vendeur.`;
      else if (order.delivery_status === 'livre') reply += `\n\n🎉 Merci pour votre confiance !`;
      return NextResponse.json({ reply, type: 'tracking', tracking });
    }

    return NextResponse.json({
      reply: `❌ Commande *${tracking}* introuvable. Vérifiez le numéro et réessayez.`,
      type: 'tracking_not_found',
      tracking,
    });
  }

  // 2. AI response
  if (aiEnabled) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return NextResponse.json({
        reply: null,
        type: 'error',
        error: 'GEMINI_API_KEY non configurée dans les variables d\'environnement Vercel.',
      });
    }
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\nClient: ${message}` }] }],
            generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
          }),
        }
      );
      const json = await res.json();
      const aiReply: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (aiReply) return NextResponse.json({ reply: aiReply, type: 'ai' });
    } catch (e: any) {
      return NextResponse.json({ reply: null, type: 'error', error: e.message });
    }
  }

  // 3. Fallback
  const fallback = language === 'french'
    ? `Bonjour 👋\nEnvoyez votre *numéro de tracking* pour suivre votre commande.`
    : language === 'arabic'
    ? `أهلاً 👋\nأرسل *رقم التتبع* الخاص بك لتتبع طلبك.`
    : `السلام عليكم 👋\nبعث لينا *رقم التتبع* ديالك باش نتبعو طردك.\nمثلاً: *ZRX123456*`;

  return NextResponse.json({ reply: fallback, type: 'fallback' });
}
