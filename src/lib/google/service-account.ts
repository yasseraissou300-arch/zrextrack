// Jeton OAuth du compte de service Google de la plateforme (portée
// spreadsheets). Les marchands partagent LEUR Sheet avec l'email de ce compte
// (onglet « Google Sheets » du chatbot), puis le serveur y ajoute les lignes.
//
// Jeton mis en cache jusqu'à 60 s avant expiration. Jamais journalisé, jamais
// renvoyé au navigateur ; la clé privée ne quitte pas l'environnement serveur.

import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let cached: { token: string; exp: number } | null = null;

/** Réservé aux tests. */
export function __resetGoogleTokenCache(): void {
  cached = null;
}

export async function getGoogleAccessToken(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !rawKey) return null;
  if (cached && cached.exp - 60_000 > now()) return cached.token;

  try {
    const iat = Math.floor(now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })
    ).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const jwt = `${header}.${payload}.${signer.sign(rawKey, 'base64url')}`;

    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) return null;
    cached = { token: json.access_token, exp: now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  } catch {
    return null;
  }
}
