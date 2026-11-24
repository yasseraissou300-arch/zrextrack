// Confirmation des commandes par WhatsApp (réponse par chiffre).
//
// Le numéro du marchand passe par Evolution (WhatsApp non officiel) : pas de
// vrais boutons fiables. Le client répond « 1 » pour confirmer, « 2 » pour
// annuler. Chaque question est enregistrée dans autotim.wa_prompts : la plus
// récente sans réponse d'un numéro décide comment lire sa réponse.
//
// Volume : chaque envoi compte dans le MÊME plafond journalier que les
// notifications de livraison (table messages, statut « envoye »). Aucun
// contournement : au-delà du plafond, rien ne part.

import type { createServiceClient } from '@/lib/supabase/server';

type Service = ReturnType<typeof createServiceClient>;

export interface ConfirmOrder {
  id: string;
  customer_name: string;
  phone: string;
  wilaya: string;
  commune: string;
  product: string;
  quantity: number;
  price: number;
  delivery_type: 'domicile' | 'stopdesk';
}

export const DEFAULT_CONFIRM_TEMPLATE = [
  'السلام عليكم {{client}} 👋',
  'وصلتنا طلبيتك :',
  '• المنتوج : *{{produit}}* × {{quantite}}',
  '• الثمن : *{{prix}} دج* (الدفع عند الاستلام)',
  '• التوصيل : {{livraison}} — {{wilaya}}',
  '',
  'باش نأكدو الطلبية، ردّ بـ :',
  '*1* ✅ نأكد الطلبية',
  '*2* ❌ نلغي الطلبية',
].join('\n');

const NBSP = new RegExp(`[${String.fromCharCode(0x202f, 0xa0)}]`, 'g');
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(NBSP, ' ');

export function buildConfirmMessage(o: ConfirmOrder, template?: string | null): string {
  const tpl = (template ?? '').trim() || DEFAULT_CONFIRM_TEMPLATE;
  return tpl
    .replace(/\{\{client\}\}/g, o.customer_name || '')
    .replace(/\{\{produit\}\}/g, o.product || 'طلبيتك')
    .replace(/\{\{quantite\}\}/g, String(o.quantity || 1))
    .replace(/\{\{prix\}\}/g, fmt(o.price || 0))
    .replace(/\{\{wilaya\}\}/g, [o.wilaya, o.commune].filter(Boolean).join(' · ') || '—')
    .replace(/\{\{livraison\}\}/g, o.delivery_type === 'stopdesk' ? 'للمكتب (stop desk)' : 'للدار');
}

// ── Lecture de la réponse du client ──────────────────────────────────────────

export type Answer = '1' | '2' | '3';

// Caractères invisibles (U+200B–U+200F, sélecteur d'emoji U+FE0F).
const INVISIBLE = new RegExp(
  `[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}]|${String.fromCharCode(0xfe0f)}`,
  'g'
);

/**
 * « 1 », « ١ », « 1 ✅ », « نعم », « oui »… → '1'. Un message libre (« wach
 * kayen l'couleur noir ? ») n'est PAS une réponse : il continue vers le
 * chatbot habituel.
 */
export function parseAnswer(raw: string, kind: 'confirm' | 'delivery' | 'rating'): Answer | null {
  const s = raw
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[*_~.!،,؟?]/g, ' ')
    .replace(INVISIBLE, '')
    .trim()
    .toLowerCase();
  if (!s || s.length > 40) return null;
  const digit = s.match(/^([1-3])(?:\s|$|[^\d])/);
  if (digit) return digit[1] as Answer;
  if (s.length > 25) return null;
  if (kind === 'confirm') {
    // (?:\s|$) et non \b : \b ne fonctionne pas après une lettre arabe.
    if (
      /^(✅|👍|نعم|ايه|إيه|واه|اكيد|أكيد|نأكد|ناكد|أكد|اكد|oui|ok|okay|wah|eyh?|confirm\w*)(?:\s|$)/.test(
        s
      )
    )
      return '1';
    if (/^(❌|👎|لا|نلغي|الغي|ألغي|لغي|non|no|annul\w*|cancel\w*|la)(?:\s|$)/.test(s)) return '2';
  }
  return null;
}

// ── Questions ouvertes (autotim.wa_prompts) ──────────────────────────────────

const prompts = (s: Service) => s.schema('autotim').from('wa_prompts');
const inbox = (s: Service) => s.schema('autotim').from('inbox_orders');

/** Une question reste « ouverte » 7 jours. */
export const PROMPT_TTL_MS = 7 * 24 * 3600 * 1000;
/** Sans réponse au bout de 24 h : la commande passe « sans réponse » (rappel à la main). */
export const NO_ANSWER_AFTER_MS = 24 * 3600 * 1000;

export async function openPrompt(
  service: Service,
  tenantId: string,
  phone: string,
  kind: 'confirm' | 'delivery' | 'rating',
  ref: string,
  sentAt: string = new Date().toISOString()
): Promise<boolean> {
  const { error } = await prompts(service).insert({
    tenant_id: tenantId,
    phone,
    kind,
    ref,
    sent_at: sentAt,
  });
  return !error;
}

export interface ReplyOutcome {
  handled: boolean;
  /** Message renvoyé au client (accusé de réception). */
  reply?: string;
  kind?: 'confirm' | 'delivery' | 'rating';
  answer?: Answer;
}

export const CONFIRM_REPLIES: Record<'1' | '2', string> = {
  '1': 'شكرا 🙏 طلبيتك تأكدت ✅ نبعثوهالك في أقرب وقت.',
  '2': 'تمام، الطلبية تلغات. إذا بغيت تعاود تطلب راحنا هنا 🙂',
};

/**
 * Message entrant d'un client : est-ce la réponse à une question ouverte ?
 * Les autres types de questions (livraison, avis) sont branchés par
 * `extraHandlers` (étapes suivantes).
 */
export async function handlePromptReply(
  service: Service,
  tenantId: string,
  phone: string,
  text: string,
  now: number = Date.now()
): Promise<ReplyOutcome> {
  if (!/^\d{8,15}$/.test(phone)) return { handled: false };
  const { data, error } = await prompts(service)
    .select('id, kind, ref, sent_at')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .is('answered_at', null)
    .gte('sent_at', new Date(now - PROMPT_TTL_MS).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return { handled: false };
  const prompt = data[0] as { id: string; kind: 'confirm' | 'delivery' | 'rating'; ref: string };

  const answer = parseAnswer(text, prompt.kind);
  if (!answer) return { handled: false };
  if (prompt.kind !== 'confirm' || answer === '3') return { handled: false };

  // La question n'est close qu'UNE fois (deux messages « 1 » rapprochés).
  const at = new Date(now).toISOString();
  const { data: closed } = await prompts(service)
    .update({ answered_at: at, answer })
    .eq('id', prompt.id)
    .is('answered_at', null)
    .select('id');
  if (!closed?.length) return { handled: true, kind: 'confirm', answer };

  await inbox(service)
    .update({ status: answer === '1' ? 'confirmed' : 'cancelled', answered_at: at, updated_at: at })
    .eq('id', prompt.ref)
    .eq('tenant_id', tenantId)
    .in('status', ['confirming', 'no_answer']);

  return { handled: true, kind: 'confirm', answer, reply: CONFIRM_REPLIES[answer] };
}

// ── Envoi des demandes de confirmation ───────────────────────────────────────

export type SendText = (phone: string, text: string) => Promise<boolean>;

export interface ConfirmSendDeps {
  service: Service;
  tenantId: string;
  send: SendText;
  /** Envoi réussi → journal `messages` (compte dans le plafond journalier). */
  logSent: (o: ConfirmOrder, text: string) => Promise<void>;
  now?: number;
}

/** Commandes restées sans réponse 24 h → « sans réponse ». */
export async function expireUnanswered(service: Service, tenantId: string, now = Date.now()) {
  await inbox(service)
    .update({ status: 'no_answer', updated_at: new Date(now).toISOString() })
    .eq('tenant_id', tenantId)
    .eq('status', 'confirming')
    .lt('confirm_sent_at', new Date(now - NO_ANSWER_AFTER_MS).toISOString());
}

/**
 * Envoie la demande de confirmation d'UNE commande (bouton « Envoyer » ou
 * envoi automatique). La commande est réclamée AVANT l'envoi (new →
 * confirming, conditionné) : deux onglets ne l'envoient jamais deux fois.
 */
export async function sendConfirmation(
  deps: ConfirmSendDeps,
  orderId: string,
  template?: string | null
): Promise<'sent' | 'not_found' | 'failed'> {
  const { service, tenantId } = deps;
  const at = new Date(deps.now ?? Date.now()).toISOString();
  const { data, error } = await inbox(service)
    .update({ status: 'confirming', confirm_sent_at: at, updated_at: at })
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .eq('status', 'new')
    .select('id, customer_name, phone, wilaya, commune, product, quantity, price, delivery_type');
  if (error || !data?.length) return 'not_found';
  const order = data[0] as ConfirmOrder;

  const text = buildConfirmMessage(order, template);
  const ok = await deps.send(order.phone, text);
  if (!ok) {
    // Rendue à « nouvelle » : rien n'est parti, on pourra réessayer.
    await inbox(service)
      .update({ status: 'new', confirm_sent_at: null, updated_at: at })
      .eq('id', order.id)
      .eq('tenant_id', tenantId)
      .eq('status', 'confirming');
    return 'failed';
  }
  await openPrompt(service, tenantId, order.phone, 'confirm', order.id, at);
  await deps.logSent(order, text);
  return 'sent';
}

/** Envoi automatique : au plus `budget` commandes, les plus anciennes d'abord. */
export async function sendPendingConfirmations(
  deps: ConfirmSendDeps,
  budget: number,
  template?: string | null
): Promise<number> {
  if (budget <= 0) return 0;
  const { data, error } = await inbox(deps.service)
    .select('id')
    .eq('tenant_id', deps.tenantId)
    .eq('status', 'new')
    .order('created_at', { ascending: true })
    .limit(budget);
  if (error || !data?.length) return 0;
  let sent = 0;
  for (const row of data as { id: string }[]) {
    const r = await sendConfirmation(deps, row.id, template);
    if (r === 'sent') sent++;
    if (r === 'failed') break; // numéro déconnecté : on n'insiste pas
  }
  return sent;
}
