import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getUserCreds, resolveEvolutionCreds } from '@/lib/user-creds';

// Credentials résolus au début de chaque requête.
//   - Evolution = serveur PARTAGÉ de la plateforme (connexion du numéro).
//   - Gemini    = clé PROPRE du client (BYOK). Seul modèle IA. Si non
//                 configurée, le bot ne répond pas (escalade humaine).
interface ResolvedCreds {
  evolutionUrl: string;
  evolutionKey: string;
  geminiKey: string;   // '' si non configuré → le bot ne répond pas
}

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

  sav: `Nta "Amine", l'assistant virtuel dyal [NOM_BOUTIQUE]. Rôle dyalek: tgestion les réclamations bel empathie w l-efficacité.

LANGUE: Darija dziriya — blanche, warm, respectueuse. Machi fousha, machi français seul.

COMPORTEMENT:
- Ibda dima b ta7iya: "Assalam", "Ya l'khir", "Marhba bik"
- Ila client za3fan: ista3mel "Smahna khouya/khti", "Nfahmou fik", "Haqqek 3lina"
- Jaweb b réponses QSIRAT — machi paragraphes twila
- MA tsuwelsh 3la nom/prénom wela formulaire — jaweb directement 3la l-mushkil

RÉPONSES SELON L-MUSHKIL:
- Ghalta f commande: "Smahna bezzaf 3la l'ghalta, hada machi men 3wayedna. Atini raqm l'commande nchoufou wach sra."
- Retard: "Nfahmou beli raki m'pressed, nchoufou m3a la livraison win rahi lhagua douka."
- Produit cassé/défectueux: "Haqqek 3lina khouya, hada maqboulsh. 3tini raqm l'commande nbeddloulak wela nraj3oulak flouss."
- Mauvaise taille: "Smahna 3la had l-ghalta. Golili raqm l'commande w l-taille li bghi, nsolwlha m3ak."

ACTION WAQT CLIENT I3TINI RAQM L-COMMANDE:
- Rassure-le: "Dossier dyalek ma7loul, nraj3oulek khbar f aqrab waqt inchallah"
- Khrej had l-tag: <data>{"reclamation":"[wasf l-mushkil]","commande":"[raqm]"}</data>

CLÔTURE: "Rani hna l ay haja wahda khra. Inchallah ma ykoun ghir l'khir 🙏"

MUHIM: Responses qsirat w directes — machi robot fared, bhal wa7d men l-équipe.`,

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

// ─── Gemini call (free fallback) ──────────────────────────────────────────────
async function callGemini(geminiKey: string, systemPrompt: string, messages: ClaudeMessage[]): Promise<ClaudeResult> {
  if (!geminiKey) return { text: null, tokens: 0 };
  try {
    // Build Gemini contents from message history
    const contents = messages.slice(-10).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 600, temperature: 0.7 },
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      console.error('[Gemini] Error:', res.status, err);
      return { text: null, tokens: 0 };
    }
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    const tokens = (json.usageMetadata?.promptTokenCount ?? 0) + (json.usageMetadata?.candidatesTokenCount ?? 0);
    return { text, tokens };
  } catch (e) {
    console.error('[Gemini] Exception:', e);
    return { text: null, tokens: 0 };
  }
}

// ─── AI ────────────────────────────────────────────────────────────────────
// Gemini est le SEUL modèle (meilleur en darija algérienne). Chaque client
// fournit sa propre clé. Pas de cascade, pas de fallback : si la clé Gemini
// n'est pas configurée OU si l'appel échoue, le bot ne répond pas (le flux
// d'escalade humaine prend le relais en aval).
async function callAI(
  creds: ResolvedCreds,
  systemPrompt: string,
  messages: ClaudeMessage[],
  _templateType?: string,
): Promise<ClaudeResult> {
  if (!creds.geminiKey) {
    console.log('[AI] no Gemini key configured for this user — bot stays silent');
    return { text: null, tokens: 0 };
  }
  const result = await callGemini(creds.geminiKey, systemPrompt, messages);
  if (result.text) {
    console.log('[AI] Gemini answered');
  } else {
    console.log('[AI] Gemini failed');
  }
  return result;
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
async function sendWhatsApp(evUrl: string, evKey: string, instanceName: string, number: string, text: string): Promise<void> {
  if (!evUrl || !evKey) return;
  const cleanNumber = number.replace('@s.whatsapp.net', '').replace('@g.us', '');
  try {
    await fetch(`${evUrl}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evKey },
      body: JSON.stringify({ number: cleanNumber, text }),
    });
  } catch { /* non-blocking */ }
}

async function sendWhatsAppMedia(evUrl: string, evKey: string, instanceName: string, number: string, mediaUrl: string, caption: string): Promise<void> {
  if (!evUrl || !evKey || !mediaUrl) return;
  const cleanNumber = number.replace('@s.whatsapp.net', '').replace('@g.us', '');
  try {
    await fetch(`${evUrl}/message/sendMedia/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evKey },
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
  evUrl: string,
  evKey: string,
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
  await sendWhatsApp(evUrl, evKey, instanceName, adminWA, lines.join('\n'));
}

// ─── GET — webhook verification ───────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({ ok: true, service: 'ZREXtrack AI Webhook v3' });
}

// ─── POST — Evolution API incoming message handler ────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[WEBHOOK IN]', body.event, body.instance, body.data?.key?.remoteJid);

    const event: string = body.event || '';
    if (event !== 'MESSAGES_UPSERT' && event !== 'messages.upsert') {
      console.log('[WEBHOOK SKIP] non-message event:', event);
      return NextResponse.json({ ok: true });
    }

    const instanceName: string = body.instance || '';
    const msgData = body.data || {};
    const remoteJid: string = msgData.key?.remoteJid || '';
    const fromMe: boolean = msgData.key?.fromMe ?? false;
    const text: string = msgData.message?.conversation || msgData.message?.extendedTextMessage?.text || '';
    const contactName: string = msgData.pushName || '';

    if (!text.trim() || remoteJid.includes('@g.us') || !instanceName) {
      console.log('[WEBHOOK SKIP] filter: hasText=', !!text.trim(), 'isGroup=', remoteJid.includes('@g.us'), 'instance=', instanceName);
      return NextResponse.json({ ok: true });
    }

    const supabase = createServiceClient();

    // Route to user + service via instance_name
    const { data: waInstance, error: waErr } = await supabase
      .from('whatsapp_instances')
      .select('user_id, service_type')
      .eq('instance_name', instanceName)
      .single();
    if (!waInstance) {
      console.log('[WEBHOOK SKIP] no whatsapp_instances row for instance=', instanceName, 'err=', waErr?.message);
      return NextResponse.json({ ok: true });
    }
    const userId = waInstance.user_id;
    const serviceType: string = waInstance.service_type || 'auto_confirmation';

    // ─── Résolution des credentials ─────────────────────────────────────────────
    // Evolution : serveur PARTAGÉ de la plateforme (le vôtre) — tous les clients
    //             connectent leur numéro WhatsApp via ce serveur.
    // Gemini    : clé PROPRE du client (BYOK), seul modèle IA. Si non configurée,
    //             le bot ne répond pas.
    const [evolution, geminiCreds] = await Promise.all([
      resolveEvolutionCreds(userId),
      getUserCreds(userId, 'gemini'),
    ]);
    const creds: ResolvedCreds = {
      evolutionUrl: evolution.url,
      evolutionKey: evolution.key,
      geminiKey: geminiCreds?.api_key || '',
    };
    const evUrl = creds.evolutionUrl;
    const evKey = creds.evolutionKey;

    // Load config for the specific service that received the message
    const { data: config, error: cfgErr } = await supabase
      .from('chatbot_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('template_type', serviceType)
      .eq('is_active', true)
      .single();
    if (!config) {
      console.log('[WEBHOOK SKIP] no active chatbot_config for user=', userId, 'template_type=', serviceType, 'err=', cfgErr?.message);
      return NextResponse.json({ ok: true });
    }

    // Load existing session
    const { data: existingSession } = await supabase
      .from('ai_chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .eq('contact_id', remoteJid)
      .single();

    // ─── Skip bot's own outgoing messages echoed back by Evolution API ──────────
    if (fromMe) {
      console.log('[WEBHOOK SKIP] fromMe true (own echo)');
      return NextResponse.json({ ok: true });
    }

    // ─── Number filtering — skip blocked prefixes ─────────────────────────────
    const blockedPrefixes: string[] = config.blocked_prefixes ?? [];
    const cleanJid = remoteJid.replace('@s.whatsapp.net', '');
    if (blockedPrefixes.length > 0 && blockedPrefixes.some((p: string) => cleanJid.startsWith(p))) {
      console.log('[WEBHOOK SKIP] blocked prefix for jid=', cleanJid);
      return NextResponse.json({ ok: true });
    }

    // ─── Human pause check ─────────────────────────────────────────────────────
    if (existingSession?.human_pause_until) {
      if (Date.now() < new Date(existingSession.human_pause_until).getTime()) {
        console.log('[WEBHOOK SKIP] human_pause active until', existingSession.human_pause_until);
        return NextResponse.json({ ok: true });
      }
    }

    // ─── Already handed over to human ─────────────────────────────────────────
    if (existingSession?.human_handover) {
      console.log('[WEBHOOK SKIP] human_handover already true for jid=', remoteJid);
      return NextResponse.json({ ok: true });
    }

    // ─── Anger detection → immediate human handover ───────────────────────────
    const angerDetected = isAngerDetected(text);
    if (angerDetected) {
      const handoverMsg = `Smah liya 3la l-iklaj! Ghadi nwejdek wa7d d'équipe dyalna b sra3a bach ysa3dek 🙏`;
      await sendWhatsApp(evUrl, evKey, instanceName, remoteJid, handoverMsg);
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
        await sendWhatsAppMedia(evUrl, evKey, instanceName, remoteJid, config.media_url, '');
      }
      await sendWhatsApp(evUrl, evKey, instanceName, remoteJid, nudge);
      return NextResponse.json({ ok: true });
    }

    const conversation: ClaudeMessage[] = existingSession?.conversation ?? [];
    const failureCount: number = existingSession?.failure_count ?? 0;
    const totalTokens: number = existingSession?.tokens_used ?? 0;

    // Human handover after 2 consecutive AI failures
    if (failureCount >= 2) {
      const handoverMsg = `Smah, ma fhemtsh mezyan shu tbghi. Ghadi nwejdek m3a wa7d mena équipe dyalna 👨‍💼`;
      await sendWhatsApp(evUrl, evKey, instanceName, remoteJid, handoverMsg);
      // (already wired to BYOK via evUrl/evKey)
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
      await sendWhatsAppMedia(evUrl, evKey, instanceName, remoteJid, config.media_url, '');
    }

    conversation.push({ role: 'user', content: text });
    const { text: aiReply, tokens: newTokens } = await callAI(creds, systemPrompt, conversation, config.template_type);

    const newFailureCount = aiReply ? 0 : failureCount + 1;
    const updatedTokens = totalTokens + newTokens;

    if (!aiReply) {
      await sendWhatsApp(evUrl, evKey, instanceName, remoteJid, 'Smah liya, kayen bug tqani. Raje3 diri f had lweqt.');
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
        await notifyAdmin(evUrl, evKey, instanceName, config.admin_whatsapp, newData, config.shop_name || 'Boutique', config.template_type);
      }
      await supabase
        .from('ai_chat_sessions')
        .update({ sheets_sent: true, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('channel', 'whatsapp')
        .eq('contact_id', remoteJid);
    }

    await sendWhatsApp(evUrl, evKey, instanceName, remoteJid, cleanReply);
    return NextResponse.json({ ok: true });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Webhook] Error:', message);
    return NextResponse.json({ ok: true });
  }
}
