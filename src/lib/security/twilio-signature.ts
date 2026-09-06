// Validation de signature Twilio — Phase 0, P0-3.
//
// Algorithme officiel Twilio (Security > Validating requests) :
//   1. Prendre l'URL complète du webhook, query string incluse.
//   2. Si la requête est un POST form-encoded : trier les paramètres par nom,
//      puis concaténer `clé + valeur` à la suite de l'URL.
//   3. HMAC-SHA1 de cette chaîne avec l'Auth Token du compte, encodé en base64.
//   4. Comparer à l'en-tête `X-Twilio-Signature` (comparaison à temps constant).
//
// Une requête forgée ne peut pas produire la signature sans l'Auth Token.

import crypto from 'crypto';

export type TwilioAuthResult =
  | { ok: true; mode: 'verified' | 'unenforced' }
  | { ok: false; reason: 'missing_signature' | 'bad_signature'; status: number };

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Signature attendue pour une URL + un jeu de paramètres POST. */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

/**
 * Valide une requête Twilio.
 *
 * `authToken` vide/absent → mode 'unenforced' : on n'applique pas encore la
 * vérification (déploiement progressif, cohérent avec le webhook WhatsApp).
 * Dès qu'un token est disponible, toute signature invalide est rejetée.
 *
 * LIMITE ASSUMÉE : Twilio ne fournit pas d'horodatage signé sur les webhooks
 * voix, donc la signature seule ne protège pas du rejeu. La protection anti-rejeu
 * est assurée séparément via `isReplay()` sur le CallSid.
 */
export function validateTwilioRequest(opts: {
  authToken: string | null | undefined;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): TwilioAuthResult {
  const { authToken, signature, url, params } = opts;

  if (!authToken) return { ok: true, mode: 'unenforced' };
  if (!signature) return { ok: false, reason: 'missing_signature', status: 401 };

  const expected = computeTwilioSignature(authToken, url, params);
  if (!safeEqual(signature, expected)) {
    return { ok: false, reason: 'bad_signature', status: 403 };
  }
  return { ok: true, mode: 'verified' };
}

/**
 * Reconstruit l'URL exacte vue par Twilio. Derrière un proxy (Vercel), il faut
 * se fier aux en-têtes `x-forwarded-*` — sinon l'URL interne diffère de celle
 * signée et toute validation échoue.
 */
export function publicUrlFromRequest(req: Request, forcedBase?: string): string {
  const original = new URL(req.url);
  if (forcedBase) {
    const base = forcedBase.replace(/\/$/, '');
    return `${base}${original.pathname}${original.search}`;
  }
  const proto = req.headers.get('x-forwarded-proto') || original.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || original.host;
  return `${proto}://${host}${original.pathname}${original.search}`;
}

/** Extrait les paramètres form-encoded d'un POST Twilio (vide pour un GET). */
export async function readTwilioParams(req: Request): Promise<Record<string, string>> {
  if (req.method !== 'POST') return {};
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/x-www-form-urlencoded')) return {};
  const text = await req.text();
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}
