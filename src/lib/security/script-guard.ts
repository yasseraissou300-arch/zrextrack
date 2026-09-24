// Garde-fou commun à TOUT script de maintenance / migration qui touche la base.
//
// INCIDENT 2026-09-24 : vite-node charge AUTOMATIQUEMENT .env / .env.local. Un
// script lancé « sans variables » a donc atteint la base de production (lecture
// seule, comptes uniquement). Règle depuis : aucun script ne cible une base
// implicitement.
//
// Ce module vérifie les variables RÉELLEMENT chargées et refuse, AVANT toute
// connexion, toute configuration absente, ambiguë ou incohérente avec la cible
// déclarée. `withGuardedClient` n'appelle la fabrique du client qu'après succès :
// un refus garantit qu'aucune connexion n'a été ouverte.
//
// Aucun secret n'est jamais renvoyé : le rapport ne contient que l'hôte de
// l'URL (public) et des booléens.

/** Ref d'un projet Supabase : 20 caractères [a-z0-9]. */
export const SUPABASE_REF_RE = /^[a-z0-9]{20}$/;

/** Cible spéciale pour une base locale (supabase start). */
export const LOCAL_TARGET = 'local';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export type GuardCode =
  | 'target_missing'
  | 'target_ambiguous'
  | 'target_invalid'
  | 'url_missing'
  | 'url_invalid'
  | 'url_insecure'
  | 'target_mismatch'
  | 'url_ambiguous'
  | 'service_key_missing'
  | 'service_key_mismatch'
  | 'service_key_wrong_role';

/** Ce qui a été réellement chargé — sans aucune valeur secrète. */
export interface EnvReport {
  target: string | null;
  url_host: string | null;
  /** `SUPABASE_URL` en plus de `NEXT_PUBLIC_SUPABASE_URL` : même hôte ou non. */
  supabase_url_alias: 'absent' | 'same' | 'different';
  service_role_present: boolean;
  /** Ref et rôle lus dans la clé JWT, quand la clé en est une. */
  service_key_ref: 'match' | 'mismatch' | 'unknown';
}

export type GuardResult =
  | { ok: true; url: string; serviceKey: string; target: string; report: EnvReport }
  | { ok: false; code: GuardCode; error: string; report: EnvReport };

type Env = Record<string, string | undefined>;

/**
 * Extrait `--target=<ref>` des arguments. Exactement une occurrence, non vide.
 * Renvoie la cible, ou un code d'erreur.
 */
export function parseTargetArg(
  argv: string[]
): { target: string } | { code: 'target_missing' | 'target_ambiguous' } {
  const found = argv.filter((a) => a === '--target' || a.startsWith('--target='));
  if (found.length === 0) return { code: 'target_missing' };
  if (found.length > 1) return { code: 'target_ambiguous' };
  const target = found[0].slice('--target='.length).trim();
  if (!target) return { code: 'target_missing' };
  return { target };
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Lit `ref` et `role` d'une clé JWT, sans vérifier la signature (inutile ici). */
function jwtClaims(key: string): { ref?: unknown; role?: unknown } | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    );
    const claims = JSON.parse(json);
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

const MESSAGES: Record<GuardCode, string> = {
  target_missing:
    '--target=<ref du projet Supabase> obligatoire : aucun accès base sans cible explicite',
  target_ambiguous: '--target fourni plusieurs fois : arrêt',
  target_invalid: `--target doit être une ref Supabase (20 caractères a-z0-9) ou "${LOCAL_TARGET}"`,
  url_missing: 'NEXT_PUBLIC_SUPABASE_URL absente',
  url_invalid: 'NEXT_PUBLIC_SUPABASE_URL invalide',
  url_insecure: 'NEXT_PUBLIC_SUPABASE_URL doit être en https (hors base locale)',
  target_mismatch: "--target ne correspond pas à l'hôte de NEXT_PUBLIC_SUPABASE_URL : arrêt",
  url_ambiguous:
    'SUPABASE_URL et NEXT_PUBLIC_SUPABASE_URL pointent vers deux hôtes différents : arrêt',
  service_key_missing: 'SUPABASE_SERVICE_ROLE_KEY absente',
  service_key_mismatch:
    'SUPABASE_SERVICE_ROLE_KEY appartient à un autre projet que --target : arrêt',
  service_key_wrong_role: "SUPABASE_SERVICE_ROLE_KEY n'est pas une clé service_role : arrêt",
};

/**
 * Vérifie qu'un script peut se connecter à la base désignée par `target`, et
 * seulement à elle. Pure : aucune E/S.
 */
export function checkScriptDbAccess(target: string | null, env: Env): GuardResult {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const host = hostOf(url);
  const aliasHost = env.SUPABASE_URL ? hostOf(env.SUPABASE_URL) : undefined;

  const report: EnvReport = {
    target,
    url_host: host,
    supabase_url_alias:
      aliasHost === undefined ? 'absent' : aliasHost === host ? 'same' : 'different',
    service_role_present: !!serviceKey,
    service_key_ref: 'unknown',
  };
  const fail = (code: GuardCode): GuardResult => ({
    ok: false,
    code,
    error: MESSAGES[code],
    report,
  });

  if (!target) return fail('target_missing');
  const isLocal = target === LOCAL_TARGET;
  if (!isLocal && !SUPABASE_REF_RE.test(target)) return fail('target_invalid');

  if (!url) return fail('url_missing');
  if (!host) return fail('url_invalid');
  const protocol = new URL(url).protocol;

  if (isLocal) {
    if (!LOCAL_HOSTS.has(host)) return fail('target_mismatch');
  } else {
    if (protocol !== 'https:') return fail('url_insecure');
    if (host !== `${target}.supabase.co`) return fail('target_mismatch');
  }

  // Deux variables d'URL divergentes : impossible de savoir laquelle le client
  // utiliserait réellement.
  if (report.supabase_url_alias === 'different') return fail('url_ambiguous');

  if (!serviceKey) return fail('service_key_missing');

  const claims = jwtClaims(serviceKey);
  if (claims) {
    if (typeof claims.ref === 'string') {
      report.service_key_ref = claims.ref === target ? 'match' : 'mismatch';
      if (!isLocal && claims.ref !== target) return fail('service_key_mismatch');
    }
    if (claims.role !== undefined && claims.role !== 'service_role') {
      return fail('service_key_wrong_role');
    }
  }

  return { ok: true, url, serviceKey, target, report };
}

/**
 * Point d'entrée des scripts : vérifie, PUIS seulement crée le client et
 * exécute `run`. En cas de refus, `factory` n'est jamais appelée.
 */
export async function withGuardedClient<C, T>(
  argv: string[],
  env: Env,
  factory: (url: string, serviceKey: string) => C,
  run: (client: C, guard: Extract<GuardResult, { ok: true }>) => Promise<T>
): Promise<
  { ok: true; value: T } | { ok: false; code: GuardCode; error: string; report: EnvReport }
> {
  const parsed = parseTargetArg(argv);
  if ('code' in parsed) {
    const r = checkScriptDbAccess(null, env);
    const code = parsed.code;
    return { ok: false, code, error: MESSAGES[code], report: r.report };
  }
  const guard = checkScriptDbAccess(parsed.target, env);
  if (!guard.ok) return guard;
  const client = factory(guard.url, guard.serviceKey);
  return { ok: true, value: await run(client, guard) };
}
