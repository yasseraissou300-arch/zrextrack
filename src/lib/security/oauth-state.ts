// Protection CSRF / liaison de compte du flux OAuth Facebook.
//
// AVANT : `state` = base64({ user_id }) non signé, et le callback l'utilisait
// comme identité. Quiconque connaissait l'UUID d'un compte pouvait terminer un
// OAuth avec SA page et l'attacher à ce compte (upsert onConflict user_id →
// la connexion Facebook de la victime était écrasée).
//
// MAINTENANT :
//   - `state` est un nonce aléatoire, sans contenu exploitable ;
//   - le même nonce est posé dans un cookie httpOnly au départ de l'OAuth ;
//   - le callback exige cookie === state (même navigateur) ET une session
//     Supabase valide : l'identité vient de la session, jamais du `state`.

import crypto from 'crypto';

export const OAUTH_STATE_COOKIE = 'fb_oauth_state';
export const OAUTH_STATE_MAX_AGE_S = 10 * 60;

export function newOAuthState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Comparaison à temps constant ; faux si l'un des deux manque. */
export function oauthStateMatches(
  fromQuery: string | null | undefined,
  fromCookie: string | null | undefined
): boolean {
  if (!fromQuery || !fromCookie) return false;
  const a = Buffer.from(fromQuery, 'utf8');
  const b = Buffer.from(fromCookie, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const oauthStateCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // Lax : le cookie accompagne la redirection GET de haut niveau depuis
  // facebook.com vers le callback, mais pas les requêtes tierces.
  sameSite: 'lax' as const,
  path: '/api/ai-chatbot/facebook',
  maxAge: OAUTH_STATE_MAX_AGE_S,
};
