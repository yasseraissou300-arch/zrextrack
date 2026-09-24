// Chiffrement applicatif des secrets (P2-9).
// Aucune valeur réelle : clés générées aléatoirement à chaque exécution,
// secrets factices.

import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  seal,
  open,
  reseal,
  sealForStorage,
  isSealed,
  maskSecret,
  parseKeyring,
  secretContext,
  encryptionConfigured,
  SecretError,
} from '@/lib/security/secret-box';

const k = () => crypto.randomBytes(32).toString('base64');
const K1 = k();
const K2 = k();
const ring = (...parts: string[]) =>
  ({ SECRETS_KEYRING: parts.join(',') }) as unknown as NodeJS.ProcessEnv;
const ENV_K1 = ring(`k1:${K1}`);
const ENV_K2_K1 = ring(`k2:${K2}`, `k1:${K1}`);

const SECRET = 'zr-test-secret-0123456789abcdef';
const CTX = secretContext('user_sync_settings', 'zrexpress_token', 'tenant-a');

function expectSecretError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SecretError);
    expect((e as SecretError).code).toBe(code);
    // Jamais de valeur secrète ni de clé dans le message ou la pile.
    const text = `${(e as Error).message}\n${(e as Error).stack}`;
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(K1);
    expect(text).not.toContain(K2);
    return;
  }
  throw new Error('SecretError attendue');
}

afterEach(() => vi.restoreAllMocks());

describe('clair → chiffré → clair', () => {
  it('seal produit une valeur préfixée, sans le clair', () => {
    const sealed = seal(SECRET, CTX, ENV_K1);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed.startsWith('enc:v1:k1:')).toBe(true);
    expect(sealed).not.toContain(SECRET);
  });

  it('open restitue la valeur originale', () => {
    expect(open(seal(SECRET, CTX, ENV_K1), CTX, ENV_K1)).toEqual({
      value: SECRET,
      legacy: false,
      stale: false,
    });
  });

  it('deux chiffrements du même secret diffèrent (IV aléatoire)', () => {
    expect(seal(SECRET, CTX, ENV_K1)).not.toBe(seal(SECRET, CTX, ENV_K1));
  });

  it('pas de double chiffrement', () => {
    const once = seal(SECRET, CTX, ENV_K1);
    expect(seal(once, CTX, ENV_K1)).toBe(once);
    expect(sealForStorage(once, CTX, ENV_K1)).toBe(once);
  });

  it('unicode et secrets longs', () => {
    const v = 'clé-ÉÀ-🔐-' + 'x'.repeat(2000);
    expect(open(seal(v, CTX, ENV_K1), CTX, ENV_K1).value).toBe(v);
  });
});

describe('échecs propres', () => {
  it('mauvaise clé → auth_failed', () => {
    const sealed = seal(SECRET, CTX, ENV_K1);
    expectSecretError(() => open(sealed, CTX, ring(`k1:${K2}`)), 'auth_failed');
  });

  it('valeur copiée dans la ligne d’un AUTRE tenant → auth_failed (AAD)', () => {
    const sealed = seal(SECRET, CTX, ENV_K1);
    const other = secretContext('user_sync_settings', 'zrexpress_token', 'tenant-b');
    expectSecretError(() => open(sealed, other, ENV_K1), 'auth_failed');
  });

  it('valeur altérée → auth_failed', () => {
    const sealed = seal(SECRET, CTX, ENV_K1);
    const last = sealed.slice(-2, -1) === 'A' ? 'B' : 'A';
    expectSecretError(
      () => open(sealed.slice(0, -2) + last + sealed.slice(-1), CTX, ENV_K1),
      'auth_failed'
    );
  });

  it('clé retirée du trousseau → unknown_key', () => {
    const sealed = seal(SECRET, CTX, ENV_K1);
    expectSecretError(() => open(sealed, CTX, ring(`k2:${K2}`)), 'unknown_key');
  });

  it('format illisible → bad_format', () => {
    expectSecretError(() => open('enc:v1:k1:@@', CTX, ENV_K1), 'bad_format');
    expectSecretError(() => open('enc:v9:k1:a:b', CTX, ENV_K1), 'bad_format');
  });

  it('trousseau mal formé → bad_keyring, sans divulguer la valeur', () => {
    expectSecretError(() => parseKeyring('k1:trop-court'), 'bad_keyring');
    expectSecretError(() => parseKeyring(`K1:${K1}`), 'bad_keyring'); // kid invalide
    expectSecretError(() => parseKeyring(`k1:${K1},k1:${K2}`), 'bad_keyring'); // doublon
  });
});

describe('secret ou clé absents', () => {
  it('trousseau absent : seal refuse (no_keyring)', () => {
    expectSecretError(() => seal(SECRET, CTX, {} as unknown as NodeJS.ProcessEnv), 'no_keyring');
    expect(encryptionConfigured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it('trousseau absent : une valeur chiffrée ne se lit pas (no_keyring)', () => {
    const sealed = seal(SECRET, CTX, ENV_K1);
    expectSecretError(() => open(sealed, CTX, {} as unknown as NodeJS.ProcessEnv), 'no_keyring');
  });

  it('déploiement progressif : sans trousseau, stockage en clair (comportement actuel)', () => {
    expect(sealForStorage(SECRET, CTX, {} as unknown as NodeJS.ProcessEnv)).toBe(SECRET);
  });

  it('SECRETS_REQUIRE_ENCRYPTION=1 sans trousseau → refus (fail-closed)', () => {
    expectSecretError(
      () =>
        sealForStorage(SECRET, CTX, {
          SECRETS_REQUIRE_ENCRYPTION: '1',
        } as unknown as NodeJS.ProcessEnv),
      'no_keyring'
    );
  });
});

describe('migration depuis le clair historique', () => {
  it('une valeur en clair se lit (legacy) — les credentials existants restent utilisables', () => {
    expect(open(SECRET, CTX, ENV_K1)).toEqual({ value: SECRET, legacy: true, stale: false });
    expect(open(SECRET, CTX, {} as unknown as NodeJS.ProcessEnv).value).toBe(SECRET);
  });

  it('reseal chiffre le clair, puis ne touche plus la valeur', () => {
    const migrated = reseal(SECRET, CTX, ENV_K1);
    expect(isSealed(migrated)).toBe(true);
    expect(open(migrated, CTX, ENV_K1).value).toBe(SECRET);
    expect(reseal(migrated, CTX, ENV_K1)).toBe(migrated);
  });
});

describe('rotation de clé', () => {
  it('nouvelle clé active : les anciennes valeurs restent lisibles et sont signalées', () => {
    const old = seal(SECRET, CTX, ENV_K1);
    const o = open(old, CTX, ENV_K2_K1);
    expect(o.value).toBe(SECRET);
    expect(o.stale).toBe(true);
  });

  it('reseal ré-écrit avec la clé active ; l’ancienne clé peut ensuite être retirée', () => {
    const rotated = reseal(seal(SECRET, CTX, ENV_K1), CTX, ENV_K2_K1);
    expect(rotated.startsWith('enc:v1:k2:')).toBe(true);
    expect(open(rotated, CTX, ring(`k2:${K2}`)).value).toBe(SECRET);
  });
});

describe('non-exposition', () => {
  it('maskSecret ne révèle jamais plus de 4 caractères', () => {
    expect(maskSecret(SECRET)).toBe('••••cdef');
    expect(maskSecret('court')).toBe('••••');
    expect(maskSecret(seal(SECRET, CTX, ENV_K1))).toBe('••••');
    expect(maskSecret(null)).toBe('');
  });

  it('aucune écriture console pendant les échecs', () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    );
    const sealed = seal(SECRET, CTX, ENV_K1);
    for (const env of [ring(`k1:${K2}`), {} as unknown as NodeJS.ProcessEnv]) {
      try {
        open(sealed, CTX, env);
      } catch {
        /* attendu */
      }
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
