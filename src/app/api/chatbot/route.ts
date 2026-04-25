import { NextRequest, NextResponse } from 'next/server';
import kb from '@/data/knowledge-base.json';

export interface SessionState {
  intent: 'order' | 'sav' | 'complaint' | null;
  step: 'detect' | 'collect_name' | 'collect_phone' | 'collect_products' | 'collect_address' | 'confirm' | 'done' | 'collect_complaint' | 'complaint_done';
  data: Record<string, string>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  message: string;
  sessionState: SessionState;
  history: ChatMessage[];
  channel: string;
}

const SYSTEM_CONTEXT = `Tu es l'assistant client de ${kb.company.name} (${kb.company.description}).

Informations clés :
- Délais de livraison : ${kb.delivery.standard_delay}
- Zones éloignées : ${kb.delivery.remote_delay}
- Couverture : ${kb.delivery.coverage}
- Livraison à domicile : ${kb.pricing.home_delivery}
- Stop-desk : ${kb.pricing.stopdesk}
- Retours : ${kb.returns.window} - ${kb.returns.conditions}
- Paiement : ${kb.payment.methods[0]}
- Contact : ${kb.company.hours}

Questions fréquentes :
${kb.faq.map(f => `Q: ${f.question}\nR: ${f.answer}`).join('\n\n')}

INSTRUCTIONS : Réponds de manière claire, chaleureuse et concise (2-4 phrases max). Utilise la même langue que le client (français, arabe, darija). N'invente pas de prix ou informations non mentionnées.`;

async function callGemini(systemPrompt: string, userMessage: string, history: ChatMessage[] = []): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const contents: { role: string; parts: { text: string }[] }[] = [];

  for (const msg of history.slice(-6)) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: `${systemPrompt}\n\nClient: ${userMessage}` }],
  });

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
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

async function detectIntent(message: string): Promise<'order' | 'complaint' | 'sav'> {
  const lower = message.toLowerCase();

  // Fast keyword detection before calling Gemini
  const orderKeywords = ['commander', 'commande', 'acheter', 'achat', 'je veux', 'je voudrais', 'passer une commande', 'order', 'نطلب', 'نشري', 'طلبية جديدة', 'bghit nchri', 'bghit ndir commande'];
  const complaintKeywords = ['problème', 'problem', 'réclamation', 'plainte', 'pas reçu', 'volé', 'abîmé', 'cassé', 'مشكل', 'شكوى', 'مشكلة', 'mashkil', 'reclamation'];

  if (orderKeywords.some(k => lower.includes(k))) return 'order';
  if (complaintKeywords.some(k => lower.includes(k))) return 'complaint';

  const classifyPrompt = `Classe ce message client en UN seul mot parmi: order, complaint, sav
- "order" = veut commander/acheter
- "complaint" = problème, réclamation, plainte
- "sav" = question sur livraison, produit, suivi, autre

Réponds UNIQUEMENT avec: order, complaint, ou sav`;

  const result = await callGemini(classifyPrompt, message);
  const clean = result?.trim().toLowerCase().split(/\s/)[0];
  if (clean === 'order') return 'order';
  if (clean === 'complaint') return 'complaint';
  return 'sav';
}

function extractPhone(text: string): string | null {
  const match = text.match(/\b(0[5-7]\d{8}|\+213\d{9}|213\d{9})\b/);
  return match ? match[1] : null;
}

function extractTracking(text: string): string | null {
  const match = text.match(/\b(ZR[XE]?\d{4,})\b/i);
  return match ? match[1].toUpperCase() : null;
}

async function notifyWebhook(type: 'order' | 'complaint', data: Record<string, string>): Promise<void> {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, timestamp: new Date().toISOString(), source: 'chatbot', ...data }),
    });
  } catch { /* non-blocking */ }
}

export async function POST(req: NextRequest) {
  const { message, sessionState, history, channel } = await req.json() as ChatRequest;

  const state: SessionState = { ...sessionState, data: { ...sessionState.data } };
  let reply = '';

  // Global: detect tracking number (except mid-order-flow)
  const tracking = extractTracking(message);
  if (tracking && state.intent !== 'order') {
    reply = `🔍 Pour suivre le colis **${tracking}**, envoyez ce numéro sur WhatsApp directement au bot de livraison.\n\nVous pouvez également consulter votre suivi sur notre site ZREXtrack.`;
    return NextResponse.json({ reply, newState: state });
  }

  switch (state.step) {
    case 'detect': {
      const intent = await detectIntent(message);

      if (intent === 'order') {
        state.intent = 'order';
        state.step = 'collect_name';
        reply = `🛒 Parfait, je prends votre commande !\n\nCommençons par votre **nom complet** :`;
      } else if (intent === 'complaint') {
        state.intent = 'complaint';
        state.step = 'collect_complaint';
        reply = `😔 Je suis désolé pour ce désagrément. Décrivez votre problème en détail et je l'enregistre immédiatement pour notre équipe :`;
      } else {
        const aiReply = await callGemini(SYSTEM_CONTEXT, message, history);
        reply = aiReply || `Je suis là pour vous aider ! Vous pouvez :\n• 📦 Suivre votre commande (envoyez le numéro de tracking)\n• 🛒 Passer une nouvelle commande\n• ❓ Poser une question sur nos services\n• 🔧 Signaler un problème`;
      }
      break;
    }

    case 'collect_name': {
      const name = message.trim().replace(/^(je suis|mon nom est|je m'appelle|c'est|اسمي|أنا)\s*/i, '').trim();
      if (name.length < 2) {
        reply = `Je n'ai pas bien compris votre nom. Pouvez-vous écrire votre **nom complet** ?`;
      } else {
        state.data.name = name;
        state.step = 'collect_phone';
        reply = `Merci **${name}** ! 😊\n\nQuel est votre **numéro de téléphone** ? (ex: 0555 123 456)`;
      }
      break;
    }

    case 'collect_phone': {
      const phone = extractPhone(message) || (message.replace(/\s/g, '').match(/\d{9,10}/) ? message.replace(/\s/g, '') : null);
      if (!phone || phone.length < 9) {
        reply = `Numéro invalide. Entrez un numéro de téléphone algérien valide (ex: 0555123456) :`;
      } else {
        state.data.phone = phone;
        state.step = 'collect_products';
        reply = `📋 Quels **produits** souhaitez-vous commander ?\n\n_(Précisez les articles, quantités et variantes)_`;
      }
      break;
    }

    case 'collect_products': {
      if (message.trim().length < 3) {
        reply = `Précisez les produits que vous souhaitez commander :`;
      } else {
        state.data.products = message.trim();
        state.step = 'collect_address';
        reply = `📍 Quelle est votre **adresse de livraison** ?\n\n_(Wilaya, commune, adresse précise)_`;
      }
      break;
    }

    case 'collect_address': {
      if (message.trim().length < 5) {
        reply = `Précisez votre adresse complète (wilaya, commune, adresse) :`;
      } else {
        state.data.address = message.trim();
        state.step = 'confirm';
        reply = `✅ **Récapitulatif de votre commande :**\n\n👤 Nom : ${state.data.name}\n📞 Téléphone : ${state.data.phone}\n🛍️ Produits : ${state.data.products}\n📍 Adresse : ${state.data.address}\n\nConfirmez-vous cette commande ? **(oui / non)**`;
      }
      break;
    }

    case 'confirm': {
      const lower = message.toLowerCase().trim();
      const isYes = /^(oui|yes|نعم|آه|ah|ewa|واه|confirm|ok|okay|yep|1|✓)/.test(lower);
      const isNo = /^(non|no|لا|nope|annuler|cancel|0|×)/.test(lower);

      if (isYes) {
        await notifyWebhook('order', state.data);
        state.step = 'done';
        state.intent = null;
        reply = `🎉 **Commande confirmée !**\n\nVotre commande a bien été enregistrée. Notre équipe vous contactera au **${state.data.phone}** sous peu pour finaliser les détails.\n\nMerci de votre confiance ! 🙏\n\nComment puis-je encore vous aider ?`;
      } else if (isNo) {
        state.step = 'detect';
        state.data = {};
        state.intent = null;
        reply = `Commande annulée. N'hésitez pas si vous souhaitez recommencer. Comment puis-je vous aider ?`;
      } else {
        reply = `Répondez **oui** pour confirmer ou **non** pour annuler la commande.`;
      }
      break;
    }

    case 'done': {
      state.step = 'detect';
      state.data = {};
      state.intent = null;
      const aiReply = await callGemini(SYSTEM_CONTEXT, message, history);
      reply = aiReply || `Comment puis-je vous aider ?`;
      break;
    }

    case 'collect_complaint': {
      if (message.trim().length < 10) {
        reply = `Décrivez votre problème avec plus de détails s'il vous plaît :`;
      } else {
        state.data.complaint = message.trim();
        state.data.ticket = `#${Date.now().toString().slice(-6)}`;
        await notifyWebhook('complaint', state.data);
        state.step = 'detect';
        state.intent = null;
        reply = `📝 **Réclamation enregistrée !**\n\nN° de ticket : **${state.data.ticket}**\n\nVotre réclamation a été transmise à notre équipe. Un conseiller vous recontactera rapidement.\n\nY a-t-il autre chose que je puisse faire pour vous ?`;
        state.data = {};
      }
      break;
    }

    default: {
      state.step = 'detect';
      reply = `Comment puis-je vous aider ?`;
    }
  }

  return NextResponse.json({ reply, newState: state });
}
