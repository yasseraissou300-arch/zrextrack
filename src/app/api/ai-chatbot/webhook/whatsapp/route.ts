import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// ─── 58 Wilayas Algeria normalization ─────────────────────────────────────────
const WILAYA_MAP: Record<string, string> = {
  // 01-10
  adrar: 'Adrar', chlef: 'Chlef', chleff: 'Chlef', 'el chlef': 'Chlef',
  laghouat: 'Laghouat', 'oum el bouaghi': 'Oum El Bouaghi', 'oum bouaghi': 'Oum El Bouaghi',
  batna: 'Batna', bejaia: 'Béjaïa', béjaïa: 'Béjaïa', bgayet: 'Béjaïa', bejaia: 'Béjaïa',
  biskra: 'Biskra', bechar: 'Béchar', béchar: 'Béchar',
  blida: 'Blida', bouira: 'Bouira',
  // 11-20
  tamanrasset: 'Tamanrasset', tamanghasset: 'Tamanrasset',
  tebessa: 'Tébessa', tébessa: 'Tébessa',
  tlemcen: 'Tlemcen', tiaret: 'Tiaret',
  'tizi ouzou': 'Tizi Ouzou', 'tizi-ouzou': 'Tizi Ouzou', 'tizi ouzu': 'Tizi Ouzou', tizi: 'Tizi Ouzou',
  alger: 'Alger', algiers: 'Alger', dzair: 'Alger',
  djelfa: 'Djelfa', jijel: 'Jijel',
  // 21-30
  setif: 'Sétif', sétif: 'Sétif', setiff: 'Sétif',
  saida: 'Saïda', saïda: 'Saïda',
  skikda: 'Skikda', 'sidi bel abbes': 'Sidi Bel Abbès', 'sidi bel abbès': 'Sidi Bel Abbès', sba: 'Sidi Bel Abbès',
  annaba: 'Annaba', guelma: 'Guelma', constantine: 'Constantine', 'qsentina': 'Constantine',
  medea: 'Médéa', médéa: 'Médéa',
  // 31-40
  mostaganem: 'Mostaganem', msila: 'M\'Sila', 'm\'sila': 'M\'Sila',
  mascara: 'Mascara', ouargla: 'Ouargla', oran: 'Oran', wahran: 'Oran',
  'el bayadh': 'El Bayadh', illizi: 'Illizi',
  'bordj bou arreridj': 'Bordj Bou Arréridj', bba: 'Bordj Bou Arréridj',
  boumerdes: 'Boumerdès', boumerdès: 'Boumerdès', boumerdes: 'Boumerdès',
  // 41-50
  'el tarf': 'El Tarf', tindouf: 'Tindouf', tissemsilt: 'Tissemsilt',
  'el oued': 'El Oued', 'eloued': 'El Oued',
  khenchela: 'Khenchela', soukahras: 'Souk Ahras', 'souk ahras': 'Souk Ahras',
  tipaza: 'Tipaza', tipasa: 'Tipaza', mila: 'Mila',
  // 51-58
  'ain defla': 'Aïn Defla', 'aïn defla': 'Aïn Defla', naama: 'Naâma', naâma: 'Naâma',
  'ain temouchent': 'Aïn Témouchent', 'aïn témouchent': 'Aïn Témouchent',
  ghardaia: 'Ghardaïa', ghardaïa: 'Ghardaïa',
  relizane: 'Relizane', timimoun: 'Timimoun',
  'bordj badji mokhtar': 'Bordj Badji Mokhtar', 'ouled djellal': 'Ouled Djellal',
  'beni abbes': 'Béni Abbès', 'in salah': 'In Salah', 'in guezzam': 'In Guezzam',
  touggourt: 'Touggourt', djanet: 'Djanet', 'el meghaier': 'El M\'Ghair',
};

function normalizeWilaya(raw: string): string {
  const clean = raw.toLowerCase().trim()
    .replace(/[éèê]/g, 'e').replace(/[àâ]/g, 'a').replace(/[îï]/g, 'i').replace(/[ôö]/g, 'o').replace(/[ùûü]/g, 'u');
  return WILAYA_MAP[clean] ?? WILAYA_MAP[raw.toLowerCase().trim()] ?? raw;
}

// ─── Anger / frustration detection ────────────────────────────────────────────
const ANGER_KEYWORDS = [
  'hram', '7ram', 'malhoul', 'mahoul', 'ndir plainte', 'nchakou', 'ghachi',
  'sba7a', 'dawir', 'faci', 'khayb', 'wahd', 'wa7d dial', 'arnab', 'nas khayba',
  'f*** ', 'merde', 'nta khayb', 'nti khayba', 'ndir fi', 'ndiru fikom',
  'hadchi mazal', 'mazal mazal', 'disappointed', 'furious', 'angry', 'scam', 'arnaque',
];

function isAngerDetected(text: string): boolean {
  const lower = text.toLowerCase();
  return ANGER_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Blabla / non-serious detection ───────────────────────────────────────────
const BLABLA_PATTERNS = [
  /^(hi|hello|salam|mrhba|ahlan|slt|cava|كيف|مرحبا|صباح|مساء)[\s!?.]*$/i,
  /^(ok|okay|oui|non|yes|no|wah|la|ewa|ewa ewa)[\s!?.]*$/i,
  /^[😀-🙏🌀-🗿🚀-🛿☀-⛿✀-➿🤀-🧿]+$/,
  /^.{1,3}$/,
];

function isBlabla(text: string): boolean {
  return BLABLA_PATTERNS.some(p => p.test(text.trim()));
}

// ─── Default system prompts ────────────────────────────────────────────────────
const DEFAULT_PROMPTS: Record<string, string> = {
  auto_confirmation: `Nta agent IA l [NOM_BOUTIQUE] — khassed tkun chi wajha réelle dyal la boutique!

Mission: jme3 had l-ma3loumat bach ntabet commande:
1. Isem w lqeb dial client
2. Numéro de téléphone
3. Wilaya (wa7d men 58 wilayat Dzayer)
4. Produit li bghah (w kammiya)

Règles muhimma:
- Jaweb bDarija Algérienne (arabizi + 3arabiya) — shl w hayé
- Ila client 3and mushkil fhm wilaya: suwelih itfaddal ybyen wilaya dyalo mn had l-lista: Alger, Oran, Constantine, Sétif, Annaba...
- MUHIM: GHIR akhrej <data> ila 3endek KULL l-ma3loumat (isem + téléphone + wilaya + produit). Ila kayna ma3loumat naqsa, wass3 tsuwal.
- Ila client machi sérieux (yazrab bla info, ysuwal des questions 7amqa), jaweb b mujamala w ntaddar info
- Ba3d <data>: "Shoukran! Ghadi nwejdek équipe dyalna bach ntakd men commande dyalek 🎉"

Format: <data>{"nom":"...","telephone":"...","wilaya":"...","produit":"..."}</data>

DIMA bDarija. Ila client kb bel français — jaweb bel français + darija.`,

  sav: `Nta agent SAV l [NOM_BOUTIQUE] — khassed tkun mdiri w hanen m3a l-client.

Mission: enregistrer réclamation bel tafasil.
Jme3:
1. Isem w lqeb
2. Numéro de téléphone
3. Wilaya
4. Produit fih l-mushkil
5. Wasf l-mushkil (shu sir, mta, kifash)

Règles:
- Ila client 3iyyam ou za3fan: khud nafs w fhem — ma tjawbsh b ghadab
- GHIR akhrej <data> waqt 3endek KULL l-info
- Ila client machi clair, suwal akter tafasil

Format: <data>{"nom":"...","telephone":"...","wilaya":"...","produit":"...","reclamation":"..."}</data>
Ba3d <data>: "Sjjalna réclamation dyalek. Ghadi ytwasslek 3la équipe dyal support f aqrab waqt 🙏"

DIMA bDarija.`,

  tracking: `Nta agent suivi commandes l [NOM_BOUTIQUE].
Jaweb 3la les questions dyal suivi des commandes.

Waqt client ybghi ya3raf statut dial commande dyalo:
- Suwelih 3la raqm l-colis (numéro de tracking)
- Waqt ya3tik raqm, khrej: <data>{"tracking_number":"..."}</data>
- Ila ma 3endo tracking number: bellegh-hom ib3tho l-message li waslhom men la boutique

Ila suwel 3la shi 7aja okhra jaweb b ma 3endek.
DIMA bDarija.`,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
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

// ─── GET — webhook verification ───────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({ ok: true, service: 'ZREXtrack AI Webhook v2' });
}

// ─── POST — Evolution API incoming message handler ────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

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

    if (fromMe || !text.trim() || remoteJid.includes('@g.us') || !instanceName) {
      return NextResponse.json({ ok: true });
    }

    const supabase = createServiceClient();

    // Route to user via instance_name
    const { data: waInstance } = await supabase
      .from('whatsapp_instances')
      .select('user_id')
      .eq('instance_name', instanceName)
      .single();

    if (!waInstance) return NextResponse.json({ ok: true });
    const userId = waInstance.user_id;

    // Load active configs
    const { data: configs } = await supabase
      .from('chatbot_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!configs || configs.length === 0) return NextResponse.json({ ok: true });

    const priority = ['auto_confirmation', 'sav', 'tracking'];
    const config = priority.map(t => configs.find(c => c.template_type === t)).find(Boolean) ?? configs[0];

    // Load existing session
    const { data: existingSession } = await supabase
      .from('ai_chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .eq('contact_id', remoteJid)
      .single();

    // Skip if already handed over to human
    if (existingSession?.human_handover) {
      return NextResponse.json({ ok: true });
    }

    // Detect anger before AI call
    const angerDetected = isAngerDetected(text);

    if (angerDetected) {
      const handoverMsg = `Smah liya 3la l-iklaj! Ghadi nwejdek wa7d d'équipe dyalna b sra3a bach ysa3dek 🙏`;
      await sendWhatsApp(instanceName, remoteJid, handoverMsg);
      if (existingSession) {
        await supabase
          .from('ai_chat_sessions')
          .update({ human_handover: true, updated_at: new Date().toISOString() })
          .eq('id', existingSession.id);
      } else {
        await supabase.from('ai_chat_sessions').insert({
          user_id: userId, channel: 'whatsapp', contact_id: remoteJid, contact_name: contactName,
          template_type: config.template_type, conversation: [], extracted_data: {},
          is_complete: false, sheets_sent: false, human_handover: true, failure_count: 0,
          updated_at: new Date().toISOString(),
        });
      }
      return NextResponse.json({ ok: true });
    }

    // Skip blabla — send friendly nudge without Claude
    if (isBlabla(text)) {
      const nudges: Record<string, string> = {
        auto_confirmation: 'Ahlan! Kifash nqdarek nsa3dek? Bghiti tdir commande? 😊',
        sav: 'Ahlan! 3andek mushkil m3a commande? Qul liya w ghadi nsa3dek 🙏',
        tracking: 'Ahlan! Bghiti t3raf statut dyal commande dyalek? 3tini raqm l-colis.',
      };
      const nudge = nudges[config.template_type] ?? nudges.auto_confirmation;
      await sendWhatsApp(instanceName, remoteJid, nudge);
      return NextResponse.json({ ok: true });
    }

    const conversation: ClaudeMessage[] = existingSession?.conversation ?? [];
    const failureCount: number = existingSession?.failure_count ?? 0;

    // Human handover after 2 consecutive failures
    if (failureCount >= 2) {
      const handoverMsg = `Smah, ma fhemtsh mezyan shu tbghi. Ghadi nwejdek m3a wa7d mena équipe dyalna 👨‍💼`;
      await sendWhatsApp(instanceName, remoteJid, handoverMsg);
      if (existingSession) {
        await supabase
          .from('ai_chat_sessions')
          .update({ human_handover: true, updated_at: new Date().toISOString() })
          .eq('id', existingSession.id);
      }
      return NextResponse.json({ ok: true });
    }

    const defaultPrompt = DEFAULT_PROMPTS[config.template_type] ?? DEFAULT_PROMPTS.auto_confirmation;
    const rawPrompt = config.custom_prompt?.trim() || defaultPrompt;
    const systemPrompt = rawPrompt.replace(/\[NOM_BOUTIQUE\]/g, config.shop_name || 'notre boutique');

    conversation.push({ role: 'user', content: text });

    const aiReply = await callClaude(systemPrompt, conversation);

    // Track failure if Claude unavailable
    const newFailureCount = aiReply ? 0 : failureCount + 1;

    if (!aiReply) {
      await sendWhatsApp(instanceName, remoteJid, 'Smah liya, kayen bug tqani. Raje3 diri f had lweqt.');
      if (existingSession) {
        await supabase
          .from('ai_chat_sessions')
          .update({ failure_count: newFailureCount, updated_at: new Date().toISOString() })
          .eq('id', existingSession.id);
      }
      return NextResponse.json({ ok: true });
    }

    const extracted = extractData(aiReply);
    const cleanReply = stripDataTag(aiReply);

    conversation.push({ role: 'assistant', content: aiReply });

    // Normalize wilaya if present
    const existingData: Record<string, string> = existingSession?.extracted_data ?? {};
    let newData = extracted ? { ...existingData, ...extracted } : existingData;
    if (newData.wilaya) newData.wilaya = normalizeWilaya(newData.wilaya);

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
          human_handover: false,
          failure_count: newFailureCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,channel,contact_id' }
      );

    // Send to Google Sheets when complete
    if (isComplete && !existingSession?.sheets_sent && config.google_sheets_url) {
      await notifyGoogleSheets(config.google_sheets_url, config.template_type, newData);
      await supabase
        .from('ai_chat_sessions')
        .update({ sheets_sent: true })
        .eq('user_id', userId)
        .eq('channel', 'whatsapp')
        .eq('contact_id', remoteJid);
    }

    if (cleanReply) {
      await sendWhatsApp(instanceName, remoteJid, cleanReply);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
