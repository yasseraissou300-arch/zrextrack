// URL publique de l'application — SOURCE UNIQUE pour les liens envoyés aux
// clients (lien de suivi {{lien}} des notifications WhatsApp).
//
// AVANT : message-builder.ts utilisait
//   process.env.NEXT_PUBLIC_SITE_URL || 'https://zrextrack6753.builtwithrocket.new'
// Or NEXT_PUBLIC_SITE_URL n'est PAS défini en Production (constat `vercel env
// ls`, 2026-09-24) : les clients recevaient un lien vers l'ancien hébergement
// Rocket, sans aucune trace dans les journaux. Une valeur mal formée (sans
// schéma, avec « / » final) donnait aussi un lien cassé.
//
// ORDRE (aucun domaine inventé ici) :
//   1. NEXT_PUBLIC_SITE_URL — choix explicite du propriétaire (HUMAN-006) ;
//   2. VERCEL_PROJECT_PRODUCTION_URL — domaine de production désigné par
//      Vercel lui-même, fourni automatiquement en Production ET en Preview
//      (une Preview envoie donc des liens vers la production, jamais vers son
//      URL de déploiement protégée) ;
//   3. ancien domaine Rocket — repli EXPLICITE, conservé pour ne pas changer
//      le comportement là où rien n'est configuré (développement local), et
//      JOURNALISÉ à chaque démarrage.
// Une valeur présente mais invalide est ignorée, journalisée, et la source
// suivante est essayée.

import { logEvent } from '@/lib/security/safe-log';

export const LEGACY_PUBLIC_URL = 'https://zrextrack6753.builtwithrocket.new';

export type PublicUrlSource =
  | 'NEXT_PUBLIC_SITE_URL'
  | 'VERCEL_PROJECT_PRODUCTION_URL'
  | 'legacy_fallback';

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalise une URL de base : schéma https imposé (http seulement en local),
 * hôte seul accepté sans schéma (forme de VERCEL_PROJECT_PRODUCTION_URL),
 * « / » final retiré. Refuse identifiants, requête et fragment. null = invalide.
 */
export function normalizeBaseUrl(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  const local = LOCAL_HOSTS.has(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (!u.hostname || u.username || u.password || u.search || u.hash) return null;
  if (!local && !u.hostname.includes('.')) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

const warned = new Set<string>();
function warnOnce(key: string, fields: Record<string, unknown>) {
  if (warned.has(key)) return;
  warned.add(key);
  logEvent('warn', 'public_url', fields);
}

/** Base publique retenue et sa provenance. Lue à l'APPEL (pas au chargement). */
export function resolvePublicBaseUrl(env: Env = process.env): {
  url: string;
  source: PublicUrlSource;
} {
  for (const source of ['NEXT_PUBLIC_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const) {
    const raw = env[source];
    if (raw == null || raw.trim() === '') continue;
    const url = normalizeBaseUrl(raw);
    if (url) return { url, source };
    warnOnce(`invalid:${source}`, { status: 'invalid_value_ignored', reason: source });
  }
  warnOnce('legacy', {
    status: 'legacy_fallback',
    reason: 'NEXT_PUBLIC_SITE_URL et VERCEL_PROJECT_PRODUCTION_URL absents ou invalides',
  });
  return { url: LEGACY_PUBLIC_URL, source: 'legacy_fallback' };
}

/** Lien public de suivi d'un colis. */
export function trackingUrl(trackingNumber: string, env: Env = process.env): string {
  return `${resolvePublicBaseUrl(env).url}/track/${encodeURIComponent(trackingNumber ?? '')}`;
}

/** Pour les tests : réarme les avertissements « une fois ». */
export function __resetPublicUrlWarnings() {
  warned.clear();
}
