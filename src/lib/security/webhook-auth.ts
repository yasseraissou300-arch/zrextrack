// Authentification des webhooks entrants — Phase 0, P0-1 / P0-3.
//
// CONTEXTE
// Evolution API (Baileys) ne signe PAS ses payloads, contrairement à Meta ou
// Shopify. Le seul mécanisme d'authentification disponible est donc un SECRET
// PARTAGÉ que la plateforme place elle-même dans l'URL du webhook au moment où
// elle l'enregistre auprès d'Evolution (`/webhook/set/<instance>`).
//
// STRATÉGIE DE DÉPLOIEMENT PROGRESSIF (non cassante)
//   - Tant que WHATSAPP_WEBHOOK_SECRET n'est PAS défini → le webhook continue
//     d'accepter les requêtes, en journalisant un avertissement. Les instances
//     déjà connectées gardent leur URL sans token : aucune régression.
//   - Dès que la variable est définie → le webhook REFUSE toute requête sans
//     secret valide. Il faut alors ré-enregistrer les URLs via
//     POST /api/ai-chatbot/whatsapp/webhook-reset (qui inclut désormais le token).
//
// Ce module ne contourne aucune protection d'un fournisseur : il ajoute une
// authentification côté plateforme, là où le fournisseur n'en offre aucune.

import crypto from 'crypto';
import type { NextRequest } from 'next/server';

export type WebhookAuthResult =
  | { ok: true; mode: 'verified' | 'unenforced' }
  | { ok: false; reason: 'missing_token' | 'bad_token'; status: number };

/** Comparaison à temps constant — évite de fuiter le secret par timing. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Vérifie le secret partagé d'un webhook.
 * Le secret est accepté depuis l'en-tête `x-webhook-token` (préféré : n'apparaît
 * pas dans les logs d'accès) ou depuis `?token=` (Evolution rappelle l'URL
 * exacte qu'on lui a donnée, en-têtes non garantis selon la version).
 */
export function verifyWebhookSecret(req: NextRequest, envVarName: string): WebhookAuthResult {
  const expected = process.env[envVarName] || '';

  // Secret non configuré → on n'applique pas encore (déploiement progressif).
  if (!expected) return { ok: true, mode: 'unenforced' };

  const provided =
    req.headers.get('x-webhook-token') || new URL(req.url).searchParams.get('token') || '';

  if (!provided) return { ok: false, reason: 'missing_token', status: 401 };
  if (!safeEqual(provided, expected)) return { ok: false, reason: 'bad_token', status: 403 };
  return { ok: true, mode: 'verified' };
}

/**
 * Construit le suffixe à ajouter à l'URL de webhook enregistrée chez le
 * fournisseur. Vide si aucun secret n'est configuré → URL inchangée.
 */
export function webhookTokenQuery(envVarName: string): string {
  const secret = process.env[envVarName] || '';
  return secret ? `?token=${encodeURIComponent(secret)}` : '';
}

// ─── Protection contre le rejeu (idempotence) ────────────────────────────────
//
// Un même événement renvoyé deux fois (retry du fournisseur, ou rejeu
// malveillant) ne doit pas déclencher deux fois l'IA ni deux envois WhatsApp.
//
// LIMITE ASSUMÉE : le cache est en mémoire, donc local à une instance
// serverless Vercel. Il bloque les rejeux rapprochés sur la même instance, pas
// un rejeu distribué. Le remplacement par un store partagé (Redis/Postgres) est
// prévu en Phase 1 avec la queue.
const seen = new Map<string, number>();
const REPLAY_TTL_MS = 10 * 60 * 1000; // 10 min

export function isReplay(eventId: string): boolean {
  if (!eventId) return false;
  const now = Date.now();

  // Purge opportuniste — garde la Map bornée sans timer.
  if (seen.size > 5000) {
    for (const [k, t] of seen) if (now - t > REPLAY_TTL_MS) seen.delete(k);
  }

  const prev = seen.get(eventId);
  if (prev !== undefined && now - prev < REPLAY_TTL_MS) return true;
  seen.set(eventId, now);
  return false;
}

// ─── Signature Meta (Facebook Messenger) ─────────────────────────────────────
//
// Contrairement à Evolution, Meta SIGNE chaque POST de webhook :
//   X-Hub-Signature-256: sha256=<HMAC-SHA256(app_secret, corps brut)>
// Sans cette vérification, n'importe qui connaissant un page_id (public) peut
// injecter de faux messages : consommation des clés Gemini du tenant, sessions
// et commandes fabriquées, faux envois vers son Google Sheet.
//
// Même déploiement progressif que verifyWebhookSecret : si FACEBOOK_APP_SECRET
// n'est pas défini, on n'applique pas (le flux OAuth Facebook ne fonctionne de
// toute façon pas sans ce secret, donc un tenant Facebook actif l'a forcément).

export type MetaSignatureResult =
  | { ok: true; mode: 'verified' | 'unenforced' }
  | { ok: false; reason: 'missing_signature' | 'bad_signature'; status: number };

/** Vérifie X-Hub-Signature-256 sur le corps BRUT (avant tout JSON.parse). */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined = process.env.FACEBOOK_APP_SECRET
): MetaSignatureResult {
  if (!appSecret) return { ok: true, mode: 'unenforced' };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature', status: 401 };

  const [algo, provided] = signatureHeader.split('=', 2);
  if (algo !== 'sha256' || !provided) {
    return { ok: false, reason: 'bad_signature', status: 403 };
  }
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  if (!safeEqual(provided.toLowerCase(), expected)) {
    return { ok: false, reason: 'bad_signature', status: 403 };
  }
  return { ok: true, mode: 'verified' };
}
