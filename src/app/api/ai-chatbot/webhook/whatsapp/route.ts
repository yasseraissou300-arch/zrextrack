import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

const DEFAULT_PROMPTS: Record<string, string> = {
  auto_confirmation: `Nta agent IA l [NOM_BOUTIQUE] — khassed tkun chi wajha réelle dyal la boutique!
Mission dyalek: jme3 les informations li la7jinhom bach ntabet la commande:
1. Isem w lqeb dial client
2. Numéro de téléphone
3. Wilaya (gouvernorat)
4. Produit li bghah (w kammiya ila kanet)

Khdm haka:
- Hayé lmessage dyalek w shl — bhal wlad darna
- Accepti Darija bel 3arabiya w bel latin/arabizi
- Waqt ma jme3ti kull l-ma3loumat, khrej:
  <data>{"nom":"...","telephone":"...","wilaya":"...","produit":"..."}</data>
- Ba3d <data>, zid: "Shoukran! Ghadi nwejdek équipe dyalna bach ntakd men commande dyalek 🎉"

MUHIM: Jaweb DIMA bDarija. Ila client kb bel français — jaweb bel français m3a Darija.`,

  sav: `Nta agent SAV l [NOM_BOUTIQUE] — khassed tkun mdiri w m3ak l-client.
Jme3 had l-ma3loumat:
1. Isem w lqeb
2. Numéro de téléphone
3. Wilaya
4. Produit fih l-mushkil
5. Wasf l-mushkil: shu sir, mta, w kifash

Waqt ma 3endek kull l-info:
<data>{"nom":"...","telephone":"...","wilaya":"...","produit":"...","reclamation":"..."}</data>
Ba3d <data>: "Sjjalna réclamation dyalek. Ghadi ytwasslek 3la équipe dyal support f aqrab waqt 🙏"

Khdm bel hnen. DIMA bDarija.`,

  tracking: `Nta agent suivi commandes l [NOM_BOUTIQUE].
Jaweb 3la les questions dyal suivi.
Waqt client ybghi ya3raf statut:
- Suwelih 3la raqm l-colis (numéro de tracking)
- Waqt ya3tik raqm, khrej: <data>{"tracking_number":"..."}</data>
- Ila ma 3endo tracking: bellegh-hom ib3tho l-message li waslhom

DIMA bDarija.`,
};

interface ClaudeMessage { role: 'user' | 'assistant'; content: string; }

async function callClaude(systemPrompt: string, messages: ClaudeMessage[]): Promise<string | null> {
  if (!ANTHROPIC_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 600,
        system: systemPrompt,
        messages: messages.slice(-10),
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.content?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

function extractData(text: string): Record<string, string> | null {
  const match = text.match(/<data>([\s\S]*?)<\/data>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function stripDataTag(text: string): string {
  return text.replace(/<data>[\s\S]*?<\/data>/g, '').trim();
}

async function sendWhatsApp(instanceName: string, number: string, text: string): Promise<void> {
  if (!EVOLUTION_URL || !EVOLUTION_KEY) return;
  const cleanNumber = number.replace('@s.whatsapp.net', '').replace('@g.us', '');
  try {
    await fetch(`${EVOLUTION_URL}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
      body: JSON.stringify({ number: cleanNumber, text }),
    });
  } catch { /* non-blocking */ }
}

async function notifyGoogleSheets(webhookUrl: string, type: string, data: Record<string, unknown>): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, timestamp: new Date().toISOString(), source: 'whatsapp_ai', ...data }),
    });
  } catch { /* non-blocking */ }
}

// GET — Evolution API webhook verification
export async function GET() {
  return NextResponse.json({ ok: true, service: 'ZREXtrack AI Webhook v1' });
}

// POST — Evolution API incoming message handler
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Evolution API sends different event types — we only care about MESSAGES_UPSERT
    const event: string = body.event || '';
    if (event !== 'MESSAGES_UPSERT' && event !== 'messages.upsert') {
      return NextResponse.json({ ok: true });
    }

    const instanceName: string = body.instance || '';
    const msgData = body.data || {};
    const remoteJid: string = msgData.key?.remoteJid || '';
    const fromMe: boolean = msgData.key?.fromMe ?? true;
    const text: string = msgData.message?.conversation || msgData.message?.extendedTextMessage?.text || '';
    const contactName: string = msgData.pushName || '';

    // Skip outgoing messages, groups, and empty messages
    if (fromMe || !text.trim() || remoteJid.includes('@g.us') || !instanceName) {
      return NextResponse.json({ ok: true });
    }

    const supabase = createServiceClient();

    // Route to user via instance_name → user_id
    const { data: waInstance } = await supabase
      .from('whatsapp_instances')
      .select('user_id')
      .eq('instance_name', instanceName)
      .single();

    if (!waInstance) return NextResponse.json({ ok: true });

    const userId = waInstance.user_id;

    // Load active template configs
    const { data: configs } = await supabase
      .from('chatbot_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!configs || configs.length === 0) return NextResponse.json({ ok: true });

    // Use first active config (priority: auto_confirmation > sav > tracking)
    const priority = ['auto_confirmation', 'sav', 'tracking'];
    const config = priority
      .map(t => configs.find(c => c.template_type === t))
      .find(Boolean) ?? configs[0];

    // Load or create chat session
    const { data: existingSession } = await supabase
      .from('ai_chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .eq('contact_id', remoteJid)
      .single();

    const conversation: ClaudeMessage[] = existingSession?.conversation ?? [];

    // Build system prompt
    const defaultPrompt = DEFAULT_PROMPTS[config.template_type] ?? DEFAULT_PROMPTS.auto_confirmation;
    const rawPrompt = config.custom_prompt?.trim() || defaultPrompt;
    const systemPrompt = rawPrompt.replace(/\[NOM_BOUTIQUE\]/g, config.shop_name || 'notre boutique');

    // Add user message
    conversation.push({ role: 'user', content: text });

    // Call Claude
    const aiReply = await callClaude(systemPrompt, conversation);

    if (!aiReply) {
      await sendWhatsApp(instanceName, remoteJid, 'Smah liya, kayen bug tqani. Raje3 diri f had lweqt.');
      return NextResponse.json({ ok: true });
    }

    // Extract structured data if present
    const extracted = extractData(aiReply);
    const cleanReply = stripDataTag(aiReply);

    // Add assistant turn
    conversation.push({ role: 'assistant', content: aiReply });

    // Merge extracted data
    const existingData: Record<string, string> = existingSession?.extracted_data ?? {};
    const newData = extracted ? { ...existingData, ...extracted } : existingData;
    const isComplete = !!extracted && Object.keys(extracted).length >= 3;

    // Upsert session
    await supabase
      .from('ai_chat_sessions')
      .upsert(
        {
          user_id: userId,
          channel: 'whatsapp',
          contact_id: remoteJid,
          contact_name: contactName,
          template_type: config.template_type,
          conversation,
          extracted_data: newData,
          is_complete: isComplete,
          sheets_sent: existingSession?.sheets_sent ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,channel,contact_id' }
      );

    // Send to Google Sheets if data complete and not already sent
    if (isComplete && !existingSession?.sheets_sent && config.google_sheets_url) {
      await notifyGoogleSheets(config.google_sheets_url, config.template_type, newData);
      await supabase
        .from('ai_chat_sessions')
        .update({ sheets_sent: true })
        .eq('user_id', userId)
        .eq('channel', 'whatsapp')
        .eq('contact_id', remoteJid);
    }

    // Send reply
    if (cleanReply) {
      await sendWhatsApp(instanceName, remoteJid, cleanReply);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
