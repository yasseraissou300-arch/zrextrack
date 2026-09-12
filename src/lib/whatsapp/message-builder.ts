// Construction des messages WhatsApp — extrait de src/app/api/sync-zrexpress/route.ts
// pour être partagé entre la route HTTP existante et le handler de file (Phase 1).
//
// Comportement STRICTEMENT identique à l'original : mêmes templates par défaut,
// mêmes variables, même normalisation de numéro. Aucune règle métier modifiée.

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://zrextrack6753.builtwithrocket.new';

/**
 * Templates par défaut en darija algérienne, utilisés quand l'utilisateur n'a
 * pas personnalisé ses messages. SOURCE UNIQUE : la table message_templates,
 * éditée dans Messages → Templates.
 */
export const DARIJA_DEFAULTS: Record<string, string> = {
  en_transit: `السلام عليكم {{client}} 👋\nطردك *{{produit}}* رقم *{{tracking}}* في الطريق لـ *{{wilaya}}*.\nتبّع هنا : {{lien}} 🚚`,
  en_livraison: `السلام عليكم {{client}} 👋\nطردك *{{produit}}* رقم *{{tracking}}* مع الليفرور دروك في *{{wilaya}}*.\nالمبلغ لي يتسلم : *{{cod}} دج*. كون فالدار 🛵`,
  livre: `السلام عليكم {{client}} 👋\nطردك *{{produit}}* رقم *{{tracking}}* وصل.\nشكرا على ثقتك فينا 🙏`,
  echec: `السلام عليكم {{client}} 👋\nحاولنا نوصلو طردك *{{tracking}}* ولقيناك ما جاوبتناش.\nتواصل معنا : {{lien}} 📞`,
  retourne: `السلام عليكم {{client}} 👋\nطردك رقم *{{tracking}}* رجع لينا.\nإذا تبغي تعاود تطلب تواصل معنا 🔄`,
};

/** Statuts qui déclenchent une notification WhatsApp. */
export const NOTIFY_STATUSES = new Set([
  'en_transit',
  'en_livraison',
  'livre',
  'echec',
  'retourne',
]);

export interface OrderVars {
  customer_name: string;
  tracking_number: string;
  wilaya: string;
  product_name: string;
  cod: number;
}

/**
 * Construit le message d'un statut à partir du template UNIFIÉ de l'utilisateur
 * (table message_templates, version darija) ou du défaut.
 * Variables : {{client}} {{tracking}} {{wilaya}} {{produit}} {{cod}} {{lien}}
 */
export function buildMessage(
  status: string,
  o: OrderVars,
  userTemplates: Map<string, string>
): string {
  const link = `${APP_URL}/track/${o.tracking_number}`;
  const tpl =
    userTemplates.get(status) || DARIJA_DEFAULTS[status] || `Mise à jour {{tracking}} : {{lien}}`;
  return tpl
    .replace(/\{\{client\}\}/g, o.customer_name || 'cher client')
    .replace(/\{\{tracking\}\}/g, o.tracking_number || '')
    .replace(/\{\{wilaya\}\}/g, o.wilaya || 'votre wilaya')
    .replace(/\{\{produit\}\}/g, o.product_name || '')
    .replace(/\{\{cod\}\}/g, String(o.cod ?? ''))
    .replace(/\{\{lien\}\}/g, link);
}

/** Normalise un numéro algérien vers 213XXXXXXXXX. */
export function normalizePhone(phone: string): string {
  const clean = (phone || '').replace(/[\s\-()+.]/g, '');
  if (clean.startsWith('213')) return clean;
  if (clean.startsWith('00213')) return clean.slice(2);
  if (clean.startsWith('0')) return '213' + clean.slice(1);
  if (clean.length === 9) return '213' + clean;
  return clean;
}

/** Un numéro exploitable fait au moins 11 caractères (213 + 8 chiffres). */
export function isSendablePhone(phone: string): boolean {
  return normalizePhone(phone).length >= 11;
}

/**
 * Charge les templates personnalisés d'un utilisateur (version darija).
 * Renvoie une Map vide si rien n'est personnalisé — les défauts s'appliquent.
 */
export async function loadUserTemplates(
  supabase: { from: (t: string) => any },
  userId: string
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('message_templates')
    .select('key, content_darija')
    .eq('user_id', userId);

  return new Map<string, string>(
    ((data as Array<{ key: string; content_darija: string | null }> | null) ?? [])
      .filter((t) => !!t.content_darija)
      .map((t) => [t.key, t.content_darija as string])
  );
}
