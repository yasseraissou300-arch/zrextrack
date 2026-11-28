// WhatsApp OFFICIEL (Meta Cloud API) — phase 1 : réservé aux comptes listés
// (le propriétaire de la plateforme pour sa propre boutique). Plus tard :
// numéro partagé pour les autres marchands, facturé au message.
//
// Pourquoi : le numéro non officiel (Evolution / Baileys) peut être banni ;
// l'API officielle n'a pas ce risque, et ses modèles de messages portent de
// VRAIS boutons (نأكّد / نلغي…) au lieu de « répondez 1 ou 2 ».
//
// Configuration (Vercel, jamais dans le code) :
//   WHATSAPP_CLOUD_TOKEN         jeton permanent (utilisateur système Meta)
//   WHATSAPP_CLOUD_PHONE_ID      identifiant du numéro (Phone number ID)
//   WHATSAPP_CLOUD_APP_SECRET    secret de l'app Meta (signature des webhooks)
//   WHATSAPP_CLOUD_VERIFY_TOKEN  jeton choisi pour valider l'URL du webhook
//   WHATSAPP_CLOUD_TENANTS       comptes AutoTim qui envoient par ce numéro
//                                (UUID séparés par des virgules)
//   WHATSAPP_CLOUD_DAILY_LIMIT   plafond quotidien (défaut 250 = limite Meta
//                                d'un compte non vérifié)
//   WHATSAPP_CLOUD_LANG          langue des modèles (défaut « ar »)
//
// Les modèles (noms ci-dessous) doivent être créés et APPROUVÉS dans
// WhatsApp Manager ; leurs textes sont dans docs/whatsapp-cloud-templates.md.

import { createHmac, timingSafeEqual } from 'node:crypto';

const GRAPH = 'https://graph.facebook.com/v21.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CloudConfig {
  token: string;
  phoneId: string;
  appSecret: string;
  verifyToken: string;
  tenants: Set<string>;
  dailyLimit: number;
  lang: string;
}

export function cloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig | null {
  const token = env.WHATSAPP_CLOUD_TOKEN?.trim();
  const phoneId = env.WHATSAPP_CLOUD_PHONE_ID?.trim();
  if (!token || !phoneId || !/^\d{5,30}$/.test(phoneId)) return null;
  const tenants = new Set(
    (env.WHATSAPP_CLOUD_TENANTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => UUID.test(s))
  );
  const limit = Number(env.WHATSAPP_CLOUD_DAILY_LIMIT);
  return {
    token,
    phoneId,
    appSecret: env.WHATSAPP_CLOUD_APP_SECRET?.trim() ?? '',
    verifyToken: env.WHATSAPP_CLOUD_VERIFY_TOKEN?.trim() ?? '',
    tenants,
    dailyLimit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 250,
    lang: env.WHATSAPP_CLOUD_LANG?.trim() || 'ar',
  };
}

/** Ce compte envoie-t-il par l'API officielle ? */
export function isCloudTenant(tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!cloudConfig(env)?.tenants.has(tenantId);
}

// ── Heures calmes : aucun envoi AUTOMATIQUE de 21:00 à 08:00 (heure d'Alger) ──

export function algiersHour(now: Date = new Date()): number {
  return (now.getUTCHours() + 1) % 24; // Algérie = UTC+1, pas d'heure d'été
}

export function isQuietHours(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env
): boolean {
  // « off » : tests automatiques uniquement (vitest.config) — jamais en production.
  if (env.WHATSAPP_QUIET_HOURS === 'off') return false;
  const h = algiersHour(now);
  return h >= 21 || h < 8;
}

/** Prochain 08:00 à Alger (07:00 UTC). */
export function nextMorning(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(7, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// ── Modèles ──────────────────────────────────────────────────────────────────

export interface TemplateVars {
  client: string;
  produit: string;
  prix?: number | string;
  livraison?: string;
  wilaya?: string;
  tracking?: string;
  cod?: number | string;
}

export interface TemplateSpec {
  name: string;
  params: (v: TemplateVars) => string[];
  /** Nombre de boutons « réponse rapide » (charges utiles « 1 », « 2 », « 3 »). */
  buttons: number;
}

const amount = (n: unknown) =>
  Math.round(Number(n) || 0)
    .toLocaleString('fr-FR')
    .replace(/\s/g, ' ');

/** Paramètre de modèle : pas de retour à la ligne ni de tabulation (règle Meta). */
export function cleanParam(v: unknown, fallback = '—'): string {
  const s = String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
    .slice(0, 300);
  return s || fallback;
}

export const TEMPLATES: Record<string, TemplateSpec> = {
  confirm: {
    name: 'autotim_confirmation',
    params: (v) => [v.client, v.produit, amount(v.prix), v.livraison ?? 'للدار', v.wilaya ?? '—'],
    buttons: 2,
  },
  en_transit: {
    name: 'autotim_en_transit',
    params: (v) => [v.client, v.produit, v.tracking ?? '—', v.livraison ?? 'للدار'],
    buttons: 0,
  },
  en_livraison: {
    name: 'autotim_en_livraison',
    params: (v) => [v.client, v.produit, amount(v.cod), v.livraison ?? 'للدار'],
    buttons: 3,
  },
  livre: {
    name: 'autotim_livre',
    params: (v) => [v.client, v.produit],
    buttons: 3,
  },
  echec: {
    name: 'autotim_echec',
    params: (v) => [v.client, v.tracking ?? '—'],
    buttons: 0,
  },
  retourne: {
    name: 'autotim_retourne',
    params: (v) => [v.client, v.tracking ?? '—'],
    buttons: 0,
  },
};

export type CloudTemplateKind = keyof typeof TEMPLATES;

export function templatePayload(
  to: string,
  kind: keyof typeof TEMPLATES,
  vars: TemplateVars,
  lang: string
): Record<string, unknown> {
  const spec = TEMPLATES[kind];
  const components: Record<string, unknown>[] = [
    {
      type: 'body',
      parameters: spec.params(vars).map((p) => ({ type: 'text', text: cleanParam(p) })),
    },
  ];
  for (let i = 0; i < spec.buttons; i++) {
    components.push({
      type: 'button',
      sub_type: 'quick_reply',
      index: String(i),
      parameters: [{ type: 'payload', payload: String(i + 1) }],
    });
  }
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name: spec.name, language: { code: lang }, components },
  };
}

export type CloudSendResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

async function post(
  cfg: CloudConfig,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<CloudSendResult> {
  try {
    const res = await fetchImpl(`${GRAPH}/${cfg.phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (res.ok && json.messages?.[0]?.id) return { ok: true, id: String(json.messages[0].id) };
    // Message d'erreur Meta (jamais le jeton)
    const err = json.error ?? {};
    return {
      ok: false,
      status: res.status,
      error: String(err.error_user_msg || err.message || `HTTP ${res.status}`).slice(0, 200),
    };
  } catch {
    return { ok: false, status: 0, error: 'Meta injoignable' };
  }
}

export function sendCloudTemplate(
  cfg: CloudConfig,
  to: string,
  kind: keyof typeof TEMPLATES,
  vars: TemplateVars,
  fetchImpl: typeof fetch = fetch
): Promise<CloudSendResult> {
  return post(cfg, templatePayload(to, kind, vars, cfg.lang), fetchImpl);
}

/** Texte libre : autorisé seulement dans les 24 h qui suivent un message du client. */
export function sendCloudText(
  cfg: CloudConfig,
  to: string,
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<CloudSendResult> {
  return post(
    cfg,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000) } },
    fetchImpl
  );
}

// ── Webhook entrant ──────────────────────────────────────────────────────────

/** Signature Meta : X-Hub-Signature-256 = « sha256=<hex HMAC du corps brut> ». */
export function validSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const got = header.slice('sha256='.length);
  if (got.length !== expected.length || !/^[0-9a-f]+$/i.test(got)) return false;
  return timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'));
}

export interface InboundMessage {
  id: string;
  from: string;
  /** Texte, ou charge utile du bouton pressé (« 1 », « 2 », « 3 »). */
  text: string;
  phoneId: string;
}

/** Messages entrants d'une notification webhook Meta (statuts de remise ignorés). */
export function inboundMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as any)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value ?? {};
      const phoneId = String(value.metadata?.phone_number_id ?? '');
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        const text =
          m?.type === 'button'
            ? (m.button?.payload ?? m.button?.text)
            : m?.type === 'interactive'
              ? (m.interactive?.button_reply?.id ?? m.interactive?.button_reply?.title)
              : m?.type === 'text'
                ? m.text?.body
                : null;
        if (!m?.id || !m?.from || typeof text !== 'string') continue;
        out.push({ id: String(m.id), from: String(m.from).replace(/\D/g, ''), text, phoneId });
      }
    }
  }
  return out;
}
