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

/** Corps JSON → commandes : objet, tableau, ou { orders: [...] } / { data: ... }. */
export function parseWebhookBody(body: unknown): {
  drafts: InboxDraft[];
  received: number;
  missing: string[];
} {
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
