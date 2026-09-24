// Chiffrement applicatif des secrets stockés en base (P2-9).
//
// Conception : docs/security/secrets-encryption.md
//
//   Algorithme  AES-256-GCM (Node crypto), IV aléatoire de 96 bits par valeur,
//               tag d'authentification de 128 bits.
//   Clés        SECRETS_KEYRING = "<kid>:<base64 32 octets>[,<kid>:<base64>…]"
//               La PREMIÈRE clé est la clé active (chiffrement) ; toutes les
//               clés listées servent au déchiffrement → rotation sans coupure.
//   Format      enc:v1:<kid>:<iv base64url>:<chiffré+tag base64url>
//   Contexte    AAD = « table.colonne:<id de ligne> » : une valeur chiffrée
//               copiée dans la ligne d'un autre tenant ne se déchiffre pas.
//   Migration   les valeurs SANS préfixe sont du clair historique : lues telles
//               quelles (marquées `legacy`) puis re-chiffrées à l'écriture.
//
// Aucune valeur secrète ni matériel de clé n'apparaît jamais dans un message
// d'erreur, un log ou une exception.

import crypto from 'crypto';

export const SEALED_PREFIX = 'enc:';
const VERSION = 'v1';
const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KID_PATTERN = /^[a-z0-9]{1,16}$/;

export type SecretErrorCode =
  | 'no_keyring' // SECRETS_KEYRING absent : impossible de chiffrer / déchiffrer
  | 'bad_keyring' // SECRETS_KEYRING mal formé
  | 'unknown_key' // valeur chiffrée avec une clé absente du trousseau
  | 'bad_format' // valeur préfixée mais illisible
  | 'auth_failed'; // mauvaise clé, contexte différent ou valeur altérée

/** Erreur sans aucune donnée sensible : seulement un code et le contexte. */
export class SecretError extends Error {
  constructor(
    readonly code: SecretErrorCode,
    readonly context: string
  ) {
    super(`secret ${code} (${context})`);
    this.name = 'SecretError';
  }
}

interface Keyring {
  activeKid: string;
  keys: Map<string, Buffer>;
}

/** Analyse SECRETS_KEYRING. null si absent ; SecretError si mal formé. */
export function parseKeyring(raw: string | undefined): Keyring | null {
  if (!raw || !raw.trim()) return null;
  const keys = new Map<string, Buffer>();
  let activeKid = '';
  for (const part of raw.split(',')) {
    const [kid, b64, ...rest] = part.trim().split(':');
    if (rest.length || !kid || !b64 || !KID_PATTERN.test(kid) || keys.has(kid)) {
      throw new SecretError('bad_keyring', 'SECRETS_KEYRING');
    }
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new SecretError('bad_keyring', 'SECRETS_KEYRING');
    keys.set(kid, key);
    if (!activeKid) activeKid = kid;
  }
  return { activeKid, keys };
}

function keyring(env: NodeJS.ProcessEnv = process.env): Keyring | null {
  return parseKeyring(env.SECRETS_KEYRING);
}

/** Chiffrement disponible dans cet environnement ? */
export function encryptionConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return keyring(env) !== null;
  } catch {
    return false;
  }
}

export function isSealed(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SEALED_PREFIX);
}

const b64url = (b: Buffer) => b.toString('base64url');

/**
 * Chiffre `plain` avec la clé active. Une valeur DÉJÀ chiffrée est renvoyée
 * telle quelle (pas de double chiffrement). Sans trousseau → SecretError.
 */
export function seal(plain: string, context: string, env: NodeJS.ProcessEnv = process.env): string {
  if (isSealed(plain)) return plain;
  const ring = keyring(env);
  if (!ring) throw new SecretError('no_keyring', context);
  const key = ring.keys.get(ring.activeKid)!;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${SEALED_PREFIX}${VERSION}:${ring.activeKid}:${b64url(iv)}:${b64url(ct)}`;
}

export interface Opened {
  value: string;
  /** Valeur stockée en clair (avant migration) : à re-chiffrer à la prochaine écriture. */
  legacy: boolean;
  /** Chiffrée avec une clé qui n'est plus la clé active : à re-chiffrer. */
  stale: boolean;
}

/** Déchiffre une valeur stockée ; le clair historique est renvoyé tel quel. */
export function open(
  stored: string,
  context: string,
  env: NodeJS.ProcessEnv = process.env
): Opened {
  if (!isSealed(stored)) return { value: stored, legacy: true, stale: false };

  const parts = stored.slice(SEALED_PREFIX.length).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretError('bad_format', context);
  const [, kid, ivB64, ctB64] = parts;

  const ring = keyring(env);
  if (!ring) throw new SecretError('no_keyring', context);
  const key = ring.keys.get(kid);
  if (!key) throw new SecretError('unknown_key', context);

  const iv = Buffer.from(ivB64, 'base64url');
  const data = Buffer.from(ctB64, 'base64url');
  if (iv.length !== IV_BYTES || data.length < TAG_BYTES) {
    throw new SecretError('bad_format', context);
  }
  try {
    const decipher = crypto.createDecipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(data.subarray(0, data.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
    return { value: plain, legacy: false, stale: kid !== ring.activeKid };
  } catch {
    throw new SecretError('auth_failed', context);
  }
}

/**
 * Valeur à ÉCRIRE en base pendant le déploiement progressif :
 *  - trousseau configuré → chiffrée ;
 *  - trousseau absent    → clair (comportement actuel), sauf si
 *    SECRETS_REQUIRE_ENCRYPTION=1, auquel cas SecretError (fail-closed).
 */
export function sealForStorage(
  plain: string,
  context: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (!keyring(env)) {
    if (env.SECRETS_REQUIRE_ENCRYPTION === '1') throw new SecretError('no_keyring', context);
    return plain;
  }
  return seal(plain, context, env);
}

/** Re-chiffre avec la clé active si la valeur est en clair ou sur une ancienne clé. */
export function reseal(
  stored: string,
  context: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const o = open(stored, context, env);
  if (!o.legacy && !o.stale) return stored;
  return seal(o.value, context, env);
}

/** Contexte canonique (AAD) d'un champ secret. */
export function secretContext(table: string, column: string, rowId: string): string {
  return `${table}.${column}:${rowId}`;
}

/** Affichage : jamais plus que les 4 derniers caractères. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (isSealed(value)) return '••••';
  return value.length <= 8 ? '••••' : `••••${value.slice(-4)}`;
}
