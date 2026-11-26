// Webhook « commande reçue » : le site du marchand (landing page, YouCan,
// boutique maison, Make / Zapier…) envoie chaque nouvelle commande en JSON ;
// elle arrive dans « À confirmer » comme une ligne du Google Sheet.
//
// Authentification : le jeton de l'URL est l'identifiant du marchand CHIFFRÉ
// (secret-box, AES-256-GCM, contexte dédié). Rien n'est stocké ; la rotation
// du trousseau garde les anciens jetons valides tant que l'ancienne clé y est.
// Un identifiant en clair n'est jamais accepté.

import { createHash } from 'node:crypto';
import { isSealed, open, seal } from '@/lib/security/secret-box';
import { parseSheet, type InboxDraft } from '@/lib/inbox/sheet-parse';

const CONTEXT = 'autotim.inbox_webhook:v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_ORDERS_PER_CALL = 50;

/** null si le chiffrement n'est pas configuré sur le serveur. */
export function webhookToken(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  try {
    return seal(tenantId, CONTEXT, env);
  } catch {
    return null;
  }
}

/** Identifiant du marchand, ou null si le jeton est invalide / en clair. */
export function tenantFromToken(
  token: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (!token || token.length > 300 || !isSealed(token)) return null;
  try {
    const { value, legacy } = open(token, CONTEXT, env);
    return !legacy && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** { client: { nom: "A" } } → { "client nom": "A" } (un niveau suffit en pratique). */
export function flattenOrder(
  raw: Record<string, unknown>,
  prefix = '',
  depth = 0
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const key = prefix ? `${prefix} ${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) {
      Object.assign(out, flattenOrder(v as Record<string, unknown>, key, depth + 1));
    } else if (Array.isArray(v)) {
      // Produits : [{ name, quantity }] → « name × quantity, … »
      const items = v
        .map((it) =>
          it && typeof it === 'object'
            ? [
                (it as any).name ?? (it as any).title ?? (it as any).product ?? '',
                (it as any).quantity ?? (it as any).qty ?? '',
              ]
                .filter((x) => String(x).trim())
                .join(' × ')
            : String(it)
        )
        .filter(Boolean);
      if (items.length) out[key] = items.join(', ');
    } else if (v !== null && v !== undefined) {
      out[key] = String(v);
    }
  }
  return out;
}

const ID_KEYS =
  /^(id|order id|order_id|orderid|reference|ref|numero|numero commande|order number|رقم الطلب)$/i;

// ── TimStore (timstore.site) ────────────────────────────────────────────────
// Webhooks sortants de TimStore : { event, shop, order: { id, reference,
// total, customer{name,phone}, shipping{wilaya,commune,address,delivery_type
// HOME|DESK}, items[{name,variant,quantity}], note } }. Lecture EXPLICITE :
// la lecture générique prendrait « shop.name » pour le nom du client et
// « subtotal » (sans livraison) pour le montant.

export function isTimStorePayload(body: unknown): boolean {
  const b = body as Record<string, any> | null;
  return !!b && typeof b === 'object' && typeof b.event === 'string' && 'order' in b && !!b.shop;
}

/** Commande TimStore → objet plat lisible par parseSheet (null si rien à créer). */
export function fromTimStore(body: Record<string, any>): Record<string, string> | null {
  if (body.event !== 'order.created') return null; // changements de statut, etc.
  const o = body.order;
  if (!o || typeof o !== 'object') return null; // « Tester » sans commande
  const items: any[] = Array.isArray(o.items) ? o.items : [];
  const product = items
    .map((i) => {
      const name = [i?.name, i?.variant ? `(${i.variant})` : ''].filter(Boolean).join(' ');
      return Number(i?.quantity) > 1 ? `${name} × ${i.quantity}` : name;
    })
    .filter(Boolean)
    .join(' + ');
  const qty = items.reduce((n, i) => n + (Number(i?.quantity) || 0), 0);
  const ship = o.shipping ?? {};
  return {
    id: `ts:${body.shop?.id ?? ''}:${o.id ?? o.reference ?? ''}`,
    nom: String(o.customer?.name ?? ''),
    telephone: String(o.customer?.phone || o.customer?.phone2 || ''),
    wilaya: String(ship.wilaya ?? ship.wilaya_id ?? ''),
    commune: String(ship.commune ?? ''),
    adresse: String(ship.address ?? ''),
    produit: product,
    quantite: String(qty > 0 ? qty : 1),
    prix: String(o.total ?? 0),
    livraison: String(ship.delivery_type ?? '').toUpperCase() === 'DESK' ? 'stop desk' : 'domicile',
    note: [o.reference ? `Réf. ${o.reference}` : '', o.note ?? ''].filter(Boolean).join(' — '),
  };
}

/** Corps JSON → commandes : objet, tableau, ou { orders: [...] } / { data: ... }. */
export function parseWebhookBody(body: unknown): {
  drafts: InboxDraft[];
  received: number;
  missing: string[];
  /** Événement reçu mais volontairement ignoré (ex. TimStore order.status_changed). */
  ignored?: boolean;
} {
  if (isTimStorePayload(body)) {
    const flat = fromTimStore(body as Record<string, any>);
    if (!flat) return { drafts: [], received: 0, missing: [], ignored: true };
    body = flat;
  }
  const list: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? Array.isArray((body as any).orders)
        ? (body as any).orders
        : (body as any).data && typeof (body as any).data === 'object'
          ? Array.isArray((body as any).data)
            ? (body as any).data
            : [(body as any).data]
          : [body]
      : [];
  const orders = list
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .slice(0, MAX_ORDERS_PER_CALL);

  const drafts: InboxDraft[] = [];
  let missing: string[] = [];
  for (const o of orders) {
    const flat = flattenOrder(o);
    const keys = Object.keys(flat);
    const values = keys.map((k) => flat[k]);
    const parsed = parseSheet([keys, values]);
    if (parsed.missing.length) {
      missing = parsed.missing;
      continue;
    }
    const d = parsed.drafts[0];
    if (!d) continue;
    // Référence stable : l'identifiant de commande du site s'il existe.
    const idKey = keys.find((k) => ID_KEYS.test(k.trim()));
    const ref = idKey && flat[idKey] ? `wh:id:${flat[idKey]}` : null;
    d.external_ref = ref
      ? ref.length <= 100
        ? ref
        : `wh:${createHash('sha1').update(ref).digest('hex').slice(0, 32)}`
      : `wh:${d.external_ref.replace(/^sh:/, '')}`;
    drafts.push(d);
  }
  return { drafts, received: orders.length, missing };
}
