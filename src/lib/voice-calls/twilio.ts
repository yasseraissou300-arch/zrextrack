// Utilitaire Twilio Voice : appels REST + construction TwiML.
// Pas de SDK lourd — juste fetch + XML pour rester léger sur Vercel.

import { createServiceClient } from '@/lib/supabase/server';

export interface VoiceCallSettings {
  account_sid: string | null;
  auth_token: string | null;
  from_number: string | null;
  shop_name: string;
  message_template: string;
  voice: string;
  confirm_text: string;
  cancel_text: string;
  no_answer_text: string;
  enabled: boolean;
}

// Tarif approximatif Twilio pour appels sortants vers mobile algérien
// (au 21/05/2026). Sert juste à estimer le coût affiché à l'utilisateur.
const TWILIO_RATE_PER_MIN_USD_DZ = 0.115;
const USD_TO_DA = 135;
const COST_PER_MIN_DA = TWILIO_RATE_PER_MIN_USD_DZ * USD_TO_DA;

export function estimateCostDA(durationSeconds: number): number {
  const minutes = Math.ceil(durationSeconds / 60);
  return Math.round(minutes * COST_PER_MIN_DA);
}

// Normalise un numéro algérien vers E.164 (+213XXXXXXXXX) pour Twilio.
export function toE164(phone: string): string {
  const clean = (phone || '').replace(/[\s\-()+.]/g, '');
  if (clean.startsWith('00')) return '+' + clean.slice(2);
  if (clean.startsWith('213')) return '+' + clean;
  if (clean.startsWith('0')) return '+213' + clean.slice(1);
  if (clean.length === 9) return '+213' + clean;
  return '+' + clean;
}

// Récupère les settings Twilio du user. Renvoie null si pas configuré.
export async function getSettings(userId: string): Promise<VoiceCallSettings | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('voice_call_settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  return (data as VoiceCallSettings | null) ?? null;
}

// Vérifie que les credentials Twilio sont prêts à émettre.
export function isReadyToCall(s: VoiceCallSettings | null): { ok: boolean; reason?: string } {
  if (!s) return { ok: false, reason: 'Settings Twilio non configurés' };
  if (!s.enabled) return { ok: false, reason: 'Module désactivé dans les paramètres' };
  if (!s.account_sid) return { ok: false, reason: 'Account SID Twilio manquant' };
  if (!s.auth_token) return { ok: false, reason: 'Auth Token Twilio manquant' };
  if (!s.from_number) return { ok: false, reason: 'Numéro Twilio « from » manquant' };
  return { ok: true };
}

// Remplace {name} {amount} {tracking} {shop_name} dans le template.
export function fillTemplate(
  template: string,
  data: { name?: string; amount?: number; tracking?: string; shop_name?: string }
): string {
  return template
    .replace(/\{name\}/g, data.name || 'sahbi')
    .replace(/\{amount\}/g, data.amount ? String(data.amount) : '0')
    .replace(/\{tracking\}/g, data.tracking || '')
    .replace(/\{shop_name\}/g, data.shop_name || 'la boutique');
}

// Construit le TwiML XML pour la 1ère interaction : lit le message + recueille
// la touche (1 = confirmer, 2 = annuler) puis route vers /gather.
export function buildInitialTwiml(opts: {
  message: string;
  voice: string;
  gatherActionUrl: string;
  noAnswerText: string;
}): string {
  // language="arb" pour les voix Polly Arabic
  const lang = opts.voice.startsWith('Polly.') ? 'arb' : 'ar-XA';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" timeout="6" action="${escapeXml(opts.gatherActionUrl)}" method="POST">
    <Say voice="${escapeXml(opts.voice)}" language="${lang}">${escapeXml(opts.message)}</Say>
  </Gather>
  <Say voice="${escapeXml(opts.voice)}" language="${lang}">${escapeXml(opts.noAnswerText)}</Say>
</Response>`;
}

// TwiML de réponse final après que le client ait tapé une touche.
export function buildFinalTwiml(voice: string, text: string): string {
  const lang = voice.startsWith('Polly.') ? 'arb' : 'ar-XA';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapeXml(voice)}" language="${lang}">${escapeXml(text)}</Say>
  <Hangup/>
</Response>`;
}

function escapeXml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Appel REST Twilio pour initier un appel sortant.
// Twilio fournit son SDK Node mais on l'évite — fetch + Basic Auth suffit.
export async function placeCall(opts: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  twimlUrl: string;
  statusCallbackUrl: string;
}): Promise<{ ok: boolean; callSid?: string; error?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Calls.json`;
  const auth = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64');
  const params = new URLSearchParams({
    From: opts.from,
    To: opts.to,
    Url: opts.twimlUrl,
    StatusCallback: opts.statusCallbackUrl,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: 'initiated ringing answered completed',
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const json = await res.json();
    if (!res.ok) {
      return { ok: false, error: json.message || `Twilio HTTP ${res.status}` };
    }
    return { ok: true, callSid: json.sid };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau Twilio' };
  }
}
