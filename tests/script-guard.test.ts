// Garde-fou des scripts base : toute configuration absente, ambiguë ou
// incohérente s'arrête AVANT la connexion (la fabrique du client n'est jamais
// appelée). Données entièrement synthétiques : aucune vraie ref, aucune vraie clé.

import { describe, it, expect, vi } from 'vitest';
import {
  checkScriptDbAccess,
  parseTargetArg,
  withGuardedClient,
  LOCAL_TARGET,
} from '@/lib/security/script-guard';

const REF = 'abcdefghijklmnopqrst'; // synthétique, 20 caractères
const OTHER = 'zzzzzzzzzzzzzzzzzzzz';

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.c2lnbmF0dXJlLXN5bnRoZXRpcXVl`;
}

const KEY = jwt({ ref: REF, role: 'service_role' });
const GOOD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: KEY,
};

async function attempt(argv: string[], env: Record<string, string | undefined>) {
  const factory = vi.fn(() => ({ fake: true }));
  const run = vi.fn(async () => 'ran');
  const result = await withGuardedClient(argv, env, factory, run);
  return { result, factory, run };
}

describe('script-guard — arrêt AVANT connexion', () => {
  const refused: Array<[string, string[], Record<string, string | undefined>, string]> = [
    ['sans --target (cas de l’incident .env.local)', [], GOOD_ENV, 'target_missing'],
    ['--target vide', ['--target='], GOOD_ENV, 'target_missing'],
    ['--target sans valeur', ['--target'], GOOD_ENV, 'target_missing'],
    ['--target en double', [`--target=${REF}`, `--target=${REF}`], GOOD_ENV, 'target_ambiguous'],
    ['--target mal formé', ['--target=prod'], GOOD_ENV, 'target_invalid'],
    ['--target d’un autre projet', [`--target=${OTHER}`], GOOD_ENV, 'target_mismatch'],
    [
      'URL absente',
      [`--target=${REF}`],
      { SUPABASE_SERVICE_ROLE_KEY: KEY },
      'url_missing',
    ],
    [
      'URL invalide',
      [`--target=${REF}`],
      { ...GOOD_ENV, NEXT_PUBLIC_SUPABASE_URL: 'pas une url' },
      'url_invalid',
    ],
    [
      'URL en http',
      [`--target=${REF}`],
      { ...GOOD_ENV, NEXT_PUBLIC_SUPABASE_URL: `http://${REF}.supabase.co` },
      'url_insecure',
    ],
    [
      'hôte qui contient la ref sans être le projet',
      [`--target=${REF}`],
      { ...GOOD_ENV, NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co.evil.example` },
      'target_mismatch',
    ],
    [
      'SUPABASE_URL divergente',
      [`--target=${REF}`],
      { ...GOOD_ENV, SUPABASE_URL: `https://${OTHER}.supabase.co` },
      'url_ambiguous',
    ],
    [
      'clé service absente',
      [`--target=${REF}`],
      { NEXT_PUBLIC_SUPABASE_URL: GOOD_ENV.NEXT_PUBLIC_SUPABASE_URL },
      'service_key_missing',
    ],
    [
      'clé d’un autre projet',
      [`--target=${REF}`],
      { ...GOOD_ENV, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: OTHER, role: 'service_role' }) },
      'service_key_mismatch',
    ],
    [
      'clé anon à la place de service_role',
      [`--target=${REF}`],
      { ...GOOD_ENV, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: 'anon' }) },
      'service_key_wrong_role',
    ],
    [
      'cible locale mais URL distante',
      [`--target=${LOCAL_TARGET}`],
      GOOD_ENV,
      'target_mismatch',
    ],
  ];

  for (const [label, argv, env, code] of refused) {
    it(`${label} → ${code}, aucune connexion`, async () => {
      const { result, factory, run } = await attempt(argv, env);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
      expect(factory).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });
  }
});

describe('script-guard — configuration explicite et cohérente', () => {
  it('connexion autorisée, avec la ref et la clé vérifiées', async () => {
    const { result, factory, run } = await attempt([`--target=${REF}`], GOOD_ENV);
    expect(result).toEqual({ ok: true, value: 'ran' });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('SUPABASE_URL identique : accepté', async () => {
    const env = { ...GOOD_ENV, SUPABASE_URL: GOOD_ENV.NEXT_PUBLIC_SUPABASE_URL };
    const { result } = await attempt([`--target=${REF}`], env);
    expect(result.ok).toBe(true);
  });

  it('clé non-JWT (format sb_secret_) : ref inconnue, acceptée sur la foi de l’URL', () => {
    const g = checkScriptDbAccess(REF, { ...GOOD_ENV, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' });
    expect(g.ok).toBe(true);
    expect(g.report.service_key_ref).toBe('unknown');
  });

  it('base locale explicite', () => {
    const g = checkScriptDbAccess(LOCAL_TARGET, {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role' }),
    });
    expect(g.ok).toBe(true);
  });
});

describe('script-guard — aucun secret dans le rapport', () => {
  it('ni la clé ni ses segments n’apparaissent, succès comme refus', () => {
    const outputs = [
      checkScriptDbAccess(REF, GOOD_ENV),
      checkScriptDbAccess(OTHER, GOOD_ENV),
      checkScriptDbAccess(REF, { ...GOOD_ENV, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: OTHER }) }),
    ].map((g) => JSON.stringify({ ...g, url: undefined, serviceKey: undefined }));
    for (const out of outputs) {
      expect(out).not.toContain(KEY);
      for (const segment of KEY.split('.')) expect(out).not.toContain(segment);
    }
  });

  it('parseTargetArg ignore les arguments voisins', () => {
    expect(parseTargetArg(['--apply', `--target=${REF}`, '--confirm=3'])).toEqual({ target: REF });
  });
});
