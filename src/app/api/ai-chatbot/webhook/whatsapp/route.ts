import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// ─── 58 Wilayas Algeria normalization ─────────────────────────────────────────
const WILAYA_MAP: Record<string, string> = {
  adrar: 'Adrar', chlef: 'Chlef', chleff: 'Chlef', 'el chlef': 'Chlef',
  laghouat: 'Laghouat', 'oum el bouaghi': 'Oum El Bouaghi', 'oum bouaghi': 'Oum El Bouaghi',
  batna: 'Batna', bejaia: 'Béjaïa', béjaïa: 'Béjaïa', bgayet: 'Béjaïa',
  biskra: 'Biskra', bechar: 'Béchar', béchar: 'Béchar',
  blida: 'Blida', bouira: 'Bouira',
  tamanrasset: 'Tamanrasset', tamanghasset: 'Tamanrasset',
  tebessa: 'Tébessa', tébessa: 'Tébessa',
  tlemcen: 'Tlemcen', tiaret: 'Tiaret',
  'tizi ouzou': 'Tizi Ouzou', 'tizi-ouzou': 'Tizi Ouzou', 'tizi ouzu': 'Tizi Ouzou', tizi: 'Tizi Ouzou',
  alger: 'Alger', algiers: 'Alger', dzair: 'Alger',
  djelfa: 'Djelfa', jijel: 'Jijel',
  setif: 'Sétif', sétif: 'Sétif', setiff: 'Sétif',
  saida: 'Saïda', saïda: 'Saïda',
  skikda: 'Skikda', 'sidi bel abbes': 'Sidi Bel Abbès', 'sidi bel abbès': 'Sidi Bel Abbès', sba: 'Sidi Bel Abbès',
  annaba: 'Annaba', guelma: 'Guelma', constantine: 'Constantine', 'qsentina': 'Constantine',
  medea: 'Médéa', médéa: 'Médéa',
  mostaganem: 'Mostaganem', msila: 'M\'Sila', 'm\'sila': 'M\'Sila',
  mascara: 'Mascara', ouargla: 'Ouargla', oran: 'Oran', wahran: 'Oran',
  'el bayadh': 'El Bayadh', illizi: 'Illizi',
  'bordj bou arreridj': 'Bordj Bou Arréridj', bba: 'Bordj Bou Arréridj',
  boumerdes: 'Boumerdès', boumerdès: 'Boumerdès',
  'el tarf': 'El Tarf', tindouf: 'Tindouf', tissemsilt: 'Tissemsilt',
  'el oued': 'El Oued', 'eloued': 'El Oued',
  khenchela: 'Khenchela', soukahras: 'Souk Ahras', 'souk ahras': 'Souk Ahras',
  tipaza: 'Tipaza', tipasa: 'Tipaza', mila: 'Mila',
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
  /^\p{Emoji}+$/u,
  /^.{1,3}$/,
];

function isBlabla(text: string): boolean {
  return BLABLA_PATTERNS.some(p => p.test(text.trim()));
}

// ─── Default system prompts ────────────────────────────────────────────────────
const DEFAULT_PROMPTS: Record<string, string> = {
  auto_confirmation: `Nta agent dyal [NOM_BOUTIQUE] — khidmtek hiya tconfirmiwi les commandes dyal clients.

PERSONNALITÉ:
- Tkellm bdarija dziriya 100% — machi maghribiya — dziriya khalis
- Ista3mel kalimat dziriya: "wach", "rabi", "sahbi/sahbti", "bezzaf", "mliha", "direct", "yallah", "3lash", "kifah", "baraka", "nshouf", "wella"
- Ista3mel arabizi dza: 3=ع, 7=ح, 9=ق, 5=خ, 8=غ, 2=ء
- Tkun warm w friendly — bhal wa7d men 3iltek ykhdem f boutique
- MATEFES: machi "dyal", machi "mashi", machi "bghit" bdarija maghribiya — DZIRIYA

MISSION — jme3 had l-ma3loumat wahed wahed:
1. L-isem w lqeb (nom complet)
2. Raqm téléphone (valide dza: 05/06/07 + 8 arqam)
3. Wilaya (wa7da men 58 wilayat dza)
4. L-produit (w l-kammiya ila bghaha)

KIFAH TKHDEM:
- Ibda b ta7iya dziriya warm: "Aslema! 👋 Merhba bik f [NOM_BOUTIQUE]..."
- Suwal 3la kull ma3louma wa7da wa7da — matefetsh kull chi f message wa7ed
- Ila client 3tak wilaya mghalta aw machi clara: suwalih y7eddha (ex: "Qsentina wella Annaba?")
- Ila raqm téléphone machi valide (maybdash b 05/06/07): "Raqm ma yban machi sah sahbi, 3awedh iktebh"
- Ila client ikteb bel français: jawbah bel français + darija m3a ba3d

VALIDATION WILAYA — waqt client i3tik wilaya:
- Qbel les variations: "Qsentina" = Constantine, "Wehran" = Oran, "Dzayer" = Alger, "Bgayet" = Béjaïa, etc.
- Ila machi clara: "Wilaya dyalek kifah? Men had l-lista: Alger, Oran, Constantine, Annaba, Sétif..."

WAQT 3ENDEK KULL CHI — akhrej had l-tag f akhir l-response:
<data>{"nom":"...","telephone":"...","wilaya":"...","produit":"..."}</data>

BA3D L-TAG: "Yallah mliha! Sjjelna commande dyalek ✅ Ghadi nwejdek quelqu'un men équipe dyalna f aqrab waqt bach ytakked m3ak. Chokran bezzaf w rabi y3awnek 🙏"

MUHIM BEZZAF:
- MATEFES l-tag <data> GHIR waqt 3endek LES 4 MA3LOUMAT complètes
- Ila wa7da naqsa: kemmel tsuwal
- Jaweb DIMA bdarija dziriya — machi français seul, machi maghribiya`,

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

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ClaudeMessage { role: 'user' | 'assistant'; content: string; }
interface ClaudeResult { text: string | null; tokens: number; }

// ─── Claude call (returns text + token count) ─────────────────────────────────
async function callClaude(systemPrompt: string, messages: ClaudeMessage[]): Promise<ClaudeResult> {
  if (!ANTHROPIC_KEY) return { text: null, tokens: 0 };
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
    if (!res.ok) return { text: null, tokens: 0 };
    const json = await res.json();
    const text = json.content?.[0]?.text ?? null;
    const tokens = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0);
    return { text, tokens };
  } catch {
    return { text: null, tokens: 0 };
  }
}

function extractData(text: string): Record<string, string> | null {
  const match = text.match(/<data>([\s\S]*?)<\/data>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch { return null; }
}

function stripDataTag(text: string): string {
  return text.replace(/<data>[\s\S]*?<\/data>/g, '').trim();
}

// ─── WhatsApp senders ─────────────────────────────────────────────────────────
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

async function sendWhatsAppMedia(instanceName: string, number: string, mediaUrl: string, caption: string): Promise<void> {
  if (!EVOLUTION_URL || !EVOLUTION_KEY || !mediaUrl) return;
  const cleanNumber = number.replace('@s.whatsapp.net', '').replace('@g.us', '');
  try {
    await fetch(`${EVOLUTION_URL}/message/sendMedia/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
      body: JSON.stringify({ number: cleanNumber, mediatype: 'image', media: mediaUrl, caption }),
    });
  } catch { /* non-blocking */ }
}

// ─── Google Sheets notifier ───────────────────────────────────────────────────
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

// ─── Admin WhatsApp notification ──────────────────────────────────────────────
async function notifyAdmin(
  instanceName: string,
  adminWA: string,
  data: Record<string, string>,
  shopName: string,
  templateType: string,
): Promise<void> {
  if (!adminWA) return;
  const lines: string[] = [`✅ *${templateType === 'sav' ? 'Réclamation' : 'Commande'} Nouvelle — ${shopName}*`];
  if (data.nom) lines.push(`👤 Nom: ${data.nom}`);
  if (data.telephone) lines.push(`📞 Tél: ${data.telephone}`);
  if (data.wilaya) lines.push(`📍 Wilaya: ${data.wilaya}`);
  if (data.produit) lines.push(`🛍️ Produit: ${data.produit}`);
  if (data.reclamation) lines.push(`⚠️ Réclamation: ${data.reclamation}`);
  if (data.tracking_number) lines.push(`📦 Tracking: ${data.tracking_number}`);
  await sendWhatsApp(instanceName, adminWA, lines.join('\n'));
}

// ─── GET — webhook verification ───────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({ ok: true, service: 'ZREXtrack AI Webhook v3' });
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
    const fromMe: boolean = msgData.key?.fromMe ?? false;
    const text: string = msgData.message?.conversation || msgData.message?.extendedTextMessage?.text || '';
    const contactName: string = msgData.pushName || '';

    if (!text.trim() || remoteJid.includes('@g.us') || !instanceName) {
      return NextResponse.json({ ok: true });
    }

    const supabase = createServiceClient();

    // Route to user + service via instance_name
    const { data: waInstance } = await supabase
      .from('whatsapp_instances')
      .select('user_id, service_type')
      .eq('instance_name', instanceName)
      .single();
    if (!waInstance) return NextResponse.json({ ok: true });
    const userId = waInstance.user_id;
    const serviceType: string = waInstance.service_type || 'auto_confirmation';

    // Load config for the specific service that received the message
    const { data: config } = await supabase
      .from('chatbot_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('template_type', serviceType)
      .eq('is_active', true)
      .single();
    if (!config) return NextResponse.json({ ok: true });

    // Load existing session
    const { data: existingSession } = await supabase
      .from('ai_chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .eq('contact_id', remoteJid)
      .single();

    // ─── Admin typing → pause AI for configured hours ─────────────────────────
    if (fromMe) {
      if (existingSession && !existingSession.human_handover) {
        const pauseHours: number = config.human_pause_hours ?? 4;
        const pauseUntil = new Date(Date.now() + pauseHours * 3600_000).toISOString();
        await supabase
          .from('ai_chat_sessions')
          .update({ human_pause_until: pauseUntil, updated_at: new Date().toISOString() })
          .eq('id', existingSession.id);
      }
      return NextResponse.json({ ok: true });
    }

    // ─── Number filtering — skip blocked prefixes ─────────────────────────────
    const blockedPrefixes: string[] = config.blocked_prefixes ?? [];
    const cleanJid = remoteJid.replace('@s.whatsapp.net', '');
    if (blockedPrefixes.length > 0 && blockedPrefixes.some((p: string) => cleanJid.startsWith(p))) {
      return NextResponse.json({ ok: true });
    }

    // ─── Human pause check ─────────────────────────────────────────────────────
    if (existingSession?.human_pause_until) {
      if (Date.now() < new Date(existingSession.human_pause_until).getTime()) {
        return NextResponse.json({ ok: true });
      }
    }

    // ─── Already handed over to human ─────────────────────────────────────────
    if (existingSession?.human_handover) {
      return NextResponse.json({ ok: true });
    }

    // ─── Anger detection → immediate human handover ───────────────────────────
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
          tokens_used: 0, updated_at: new Date().toISOString(),
        });
      }
      return NextResponse.json({ ok: true });
    }

    // ─── Blabla → friendly nudge without Claude ───────────────────────────────
    if (isBlabla(text)) {
      const nudges: Record<string, string> = {
        auto_confirmation: 'Ahlan! Kifash nqdarek nsa3dek? Bghiti tdir commande? 😊',
        sav: 'Ahlan! 3andek mushkil m3a commande? Qul liya w ghadi nsa3dek 🙏',
        tracking: 'Ahlan! Bghiti t3raf statut dyal commande dyalek? 3tini raqm l-colis.',
      };
      const nudge = nudges[config.template_type] ?? nudges.auto_confirmation;
      // Send product image on first contact if configured
      if (!existingSession && config.media_url) {
        await sendWhatsAppMedia(instanceName, remoteJid, config.media_url, '');
      }
      await sendWhatsApp(instanceName, remoteJid, nudge);
      return NextResponse.json({ ok: true });
    }

    const conversation: ClaudeMessage[] = existingSession?.conversation ?? [];
    const failureCount: number = existingSession?.failure_count ?? 0;
    const totalTokens: number = existingSession?.tokens_used ?? 0;

    // Human handover after 2 consecutive AI failures
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

    // Send product image on first message if configured
    if (!existingSession && config.media_url) {
      await sendWhatsAppMedia(instanceName, remoteJid, config.media_url, '');
    }

    conversation.push({ role: 'user', content: text });
    const { text: aiReply, tokens: newTokens } = await callClaude(systemPrompt, conversation);

    const newFailureCount = aiReply ? 0 : failureCount + 1;
    const updatedTokens = totalTokens + newTokens;

    if (!aiReply) {
      await sendWhatsApp(instanceName, remoteJid, 'Smah liya, kayen bug tqani. Raje3 diri f had lweqt.');
      if (existingSession) {
        await supabase
          .from('ai_chat_sessions')
          .update({ failure_count: newFailureCount, tokens_used: updatedTokens, updated_at: new Date().toISOString() })
          .eq('id', existingSession.id);
      }
      return NextResponse.json({ ok: true });
    }

    const extracted = extractData(aiReply);
    const cleanReply = stripDataTag(aiReply);

    conversation.push({ role: 'assistant', content: aiReply });

    const existingData: Record<string, string> = existingSession?.extracted_data ?? {};
    let newData = extracted ? { ...existingData, ...extracted } : existingData;
    if (newData.wilaya) newData.wilaya = normalizeWilaya(newData.wilaya);

    const isComplete = !!extracted && Object.keys(extracted).length >= 3;

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
          tokens_used: updatedTokens,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,channel,contact_id' }
      );

    // Google Sheets + admin notification on completion
    if (isComplete && !existingSession?.sheets_sent) {
      if (config.google_sheets_url) {
        await notifyGoogleSheets(config.google_sheets_url, config.template_type, newData);
      }
      if (config.admin_whatsapp) {
        await notifyAdmin(instanceName, config.admin_whatsapp, newData, config.shop_name || 'Boutique', config.template_type);
      }
      await supabase
        .from('ai_chat_sessions')
        .update({ sheets_sent: true, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('channel', 'whatsapp')
        .eq('contact_id', remoteJid);
    }

    await sendWhatsApp(instanceName, remoteJid, cleanReply);
    return NextResponse.json({ ok: true });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Webhook] Error:', message);
    return NextResponse.json({ ok: true });
  }
}