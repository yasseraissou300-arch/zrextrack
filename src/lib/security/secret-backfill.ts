// P2-9 phase 3 — migration des secrets existants (chiffrement) et son inverse.
//
// Conception : docs/security/secrets-encryption.md §6.
// Exécution : scripts/secrets-backfill.ts (manuelle, SIMULATION par défaut).
//
// Garanties, vérifiées par tests/secret-backfill.test.ts :
//   - SIMULATION par défaut : aucune écriture sans `apply` ET toutes les
//     conditions de sécurité (applyBlockers) ;
//   - aucune valeur (claire ou chiffrée) dans le rapport ni dans les logs :
//     seulement des COMPTES et des codes d'erreur ;
//   - chaque nouvelle valeur est RELUE et comparée à l'ancienne AVANT
//     l'écriture : une ancienne valeur n'est jamais remplacée par un chiffré
//     non validé, et jamais supprimée ;
//   - écriture conditionnelle (colonne = ancienne valeur) : une modification
//     concurrente par l'utilisateur n'est jamais écrasée (compté `conflicts`) ;
//   - idempotent et reprenable : une valeur déjà sur la clé active est
//     ignorée ; relancer après une interruption termine le travail ;
//   - pas de double chiffrement ; rotation de clé (valeurs `stale`) ;
//   - valeur illisible (clé absente du trousseau, altération) : jamais
//     écrite ; bloque le mode réel tant qu'elle existe.

import type { createServiceClient } from '@/lib/supabase/server';
import {
  isSealed,
  open,
  parseKeyring,
  seal,
  secretContext,
  SecretError,
} from '@/lib/security/secret-box';

type Client = ReturnType<typeof createServiceClient>;
type Row = Record<string, unknown>;

/** Un champ secret : où il est, comment identifier sa ligne, son contexte AAD. */
export interface SecretField {
  table: string;
  column: string;
  keyColumns: string[];
  context: (row: Row) => string;
}

/**
 * Registre des champs secrets. Les contextes DOIVENT être identiques à ceux
 * du code applicatif (vérifié par test) — sinon les valeurs migrées seraient
 * illisibles à l'exécution.
 */
export const SECRET_FIELDS: SecretField[] = [
  {
    table: 'user_sync_settings',
    column: 'zrexpress_token',
    keyColumns: ['user_id'],
    context: (r) => secretContext('user_sync_settings', 'zrexpress_token', String(r.user_id)),
  },
  ...(['api_key', 'api_secret'] as const).map((column) => ({
    table: 'user_api_credentials',
    column,
    keyColumns: ['user_id', 'service'],
    context: (r: Row) =>
      secretContext('user_api_credentials', column, `${String(r.user_id)}:${String(r.service)}`),
  })),
  ...(['page_access_token', 'pending_pages'] as const).map((column) => ({
    table: 'facebook_connections',
    column,
    keyColumns: ['user_id'],
    context: (r: Row) => secretContext('facebook_connections', column, String(r.user_id)),
  })),
];

export type Mode = 'encrypt' | 'decrypt';

export interface FieldReport {
  field: string;
  scanned: number;
  empty: number;
  plaintext: number;
  sealed_active: number;
  sealed_stale: number;
  unreadable: number;
  /** Lignes qui seraient (simulation) ou ont été (réel) modifiées. */
  planned: number;
  written: number;
  conflicts: number;
  /** Codes d'erreur de lecture, par code — jamais de valeur. */
  errors: Record<string, number>;
}

export interface BackfillReport {
  mode: Mode;
  apply: boolean;
  active_kid: string | null;
  fields: FieldReport[];
  totals: { planned: number; written: number; unreadable: number; conflicts: number };
}

const PAGE = 500;

function newReport(field: SecretField): FieldReport {
  return {
    field: `${field.table}.${field.column}`,
    scanned: 0,
    empty: 0,
    plaintext: 0,
    sealed_active: 0,
    sealed_stale: 0,
    unreadable: 0,
    planned: 0,
    written: 0,
    conflicts: 0,
    errors: {},
  };
}

/** Transformation d'UNE valeur ; null = rien à faire. Aucune écriture ici. */
export function planValue(
  mode: Mode,
  stored: string,
  context: string,
  env: NodeJS.ProcessEnv
): { next: string | null; kind: 'plaintext' | 'sealed_active' | 'sealed_stale' } {
  const o = open(stored, context, env); // lève SecretError si illisible
  const kind = o.legacy ? 'plaintext' : o.stale ? 'sealed_stale' : 'sealed_active';

  if (mode === 'encrypt') {
    if (kind === 'sealed_active') return { next: null, kind }; // idempotence
    const next = seal(o.value, context, env); // clair ou ancienne clé → clé active
    // Validation AVANT écriture : le chiffré se relit et redonne la même valeur.
    const check = open(next, context, env);
    if (check.value !== o.value || check.legacy || check.stale) {
      throw new SecretError('auth_failed', context);
    }
    return { next, kind };
  }

  // decrypt (retour arrière) : chiffré → clair ; le clair reste tel quel.
  if (kind === 'plaintext') return { next: null, kind };
  if (!o.value) throw new SecretError('bad_format', context);
  return { next: o.value, kind };
}

async function readPage(supabase: Client, field: SecretField, from: number) {
  let q = supabase.from(field.table).select([...field.keyColumns, field.column].join(', '));
  for (const k of field.keyColumns) q = q.order(k, { ascending: true });
  return q.range(from, from + PAGE - 1);
}

/**
 * Parcourt tous les champs secrets. En simulation (`apply: false`), ne fait
 * AUCUNE écriture. En réel, n'écrit que des valeurs validées, de façon
 * conditionnelle. Ne lève pas : tout est compté dans le rapport.
 */
export async function runBackfill(
  supabase: Client,
  opts: { mode: Mode; apply: boolean; env?: NodeJS.ProcessEnv; fields?: SecretField[] }
): Promise<BackfillReport> {
  const env = opts.env ?? process.env;
  let ring: ReturnType<typeof parseKeyring> = null;
  try {
    ring = parseKeyring(env.SECRETS_KEYRING);
  } catch {
    ring = null; // mal formé : chaque valeur remontera une erreur, rien n'est écrit
  }
  const fields = opts.fields ?? SECRET_FIELDS;
  const report: BackfillReport = {
    mode: opts.mode,
    apply: opts.apply,
    active_kid: ring?.activeKid ?? null,
    fields: [],
    totals: { planned: 0, written: 0, unreadable: 0, conflicts: 0 },
  };

  for (const field of fields) {
    const fr = newReport(field);
    report.fields.push(fr);

    for (let from = 0; ; from += PAGE) {
      const { data, error } = await readPage(supabase, field, from);
      if (error) {
        // Table absente (ex. facebook_connections non créée) : comptée, pas fatale.
        fr.errors[`read:${error.code ?? 'unknown'}`] =
          (fr.errors[`read:${error.code ?? 'unknown'}`] ?? 0) + 1;
        break;
      }
      const rows = (data ?? []) as unknown as Row[];

      for (const row of rows) {
        fr.scanned++;
        const stored = row[field.column];
        if (typeof stored !== 'string' || stored === '') {
          fr.empty++;
          continue;
        }
        let plan: ReturnType<typeof planValue>;
        try {
          plan = planValue(opts.mode, stored, field.context(row), env);
        } catch (e) {
          const code = e instanceof SecretError ? e.code : 'unknown';
          fr.errors[code] = (fr.errors[code] ?? 0) + 1;
          // Trousseau absent : une valeur en clair reste « en clair », rien de
          // prévu (le mode réel sera de toute façon refusé).
          if (code === 'no_keyring' && !isSealed(stored)) fr.plaintext++;
          else fr.unreadable++;
          continue;
        }
        fr[plan.kind]++;
        if (plan.next === null) continue;
        fr.planned++;
        if (!opts.apply) continue;

        // Écriture CONDITIONNELLE : seulement si la valeur n'a pas changé
        // depuis la lecture (l'utilisateur a pu enregistrer une nouvelle clé).
        let u = supabase.from(field.table).update({ [field.column]: plan.next });
        for (const k of field.keyColumns) u = u.eq(k, row[k] as string);
        const { data: updated, error: upErr } = await u
          .eq(field.column, stored)
          .select(field.keyColumns[0]);
        if (upErr || !Array.isArray(updated) || updated.length !== 1) {
          fr.conflicts++;
          continue;
        }
        fr.written++;
      }

      if (rows.length < PAGE) break;
    }

    report.totals.planned += fr.planned;
    report.totals.written += fr.written;
    report.totals.unreadable += fr.unreadable;
    report.totals.conflicts += fr.conflicts;
  }
  return report;
}

/** Raisons (sans valeur) pour lesquelles le mode réel est refusé. Vide = autorisé. */
export function applyBlockers(opts: {
  mode: Mode;
  env: NodeJS.ProcessEnv;
  now: Date;
  freezeUntil: Date;
  backupConfirmed: boolean;
  confirmCount: number | null;
  dryRun: BackfillReport;
}): string[] {
  const b: string[] = [];
  if (opts.now.getTime() < opts.freezeUntil.getTime()) {
    b.push(`gel de production actif jusqu'au ${opts.freezeUntil.toISOString()}`);
  }
  let ringOk = false;
  try {
    ringOk = parseKeyring(opts.env.SECRETS_KEYRING) !== null;
  } catch {
    b.push('SECRETS_KEYRING mal formé');
  }
  if (!ringOk && !b.includes('SECRETS_KEYRING mal formé')) b.push('SECRETS_KEYRING absent');
  if (!opts.backupConfirmed) b.push('sauvegarde non confirmée (--backup-confirmed)');
  if (opts.dryRun.totals.unreadable > 0) {
    b.push(
      `${opts.dryRun.totals.unreadable} valeur(s) illisible(s) : corriger le trousseau d'abord`
    );
  }
  if (opts.confirmCount === null) {
    b.push('--confirm=<N> manquant (N = « planned » de la simulation relue)');
  } else if (opts.confirmCount !== opts.dryRun.totals.planned) {
    b.push(
      `--confirm=${opts.confirmCount} ≠ ${opts.dryRun.totals.planned} lignes prévues : relancer la simulation`
    );
  }
  return b;
}

/** Date de fin du gel de la fenêtre 72 h v2 : aucune migration réelle avant. */
export const FREEZE_UNTIL = new Date('2026-09-26T22:15:00Z');

// ─── Commande (utilisée par scripts/secrets-backfill.ts) ──────────────────────

export interface CommandArgs {
  mode: Mode;
  apply: boolean;
  backupConfirmed: boolean;
  confirmCount: number | null;
}

export function parseArgs(argv: string[]): CommandArgs | { error: string } {
  const get = (name: string) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  const val = (name: string) => get(name)?.split('=').slice(1).join('=') ?? null;

  const mode = val('mode');
  if (mode !== 'encrypt' && mode !== 'decrypt') {
    return { error: '--mode=encrypt|decrypt obligatoire' };
  }
  const confirmRaw = val('confirm');
  const confirmCount =
    confirmRaw === null ? null : /^\d+$/.test(confirmRaw) ? Number(confirmRaw) : NaN;
  if (Number.isNaN(confirmCount)) return { error: '--confirm=<entier> attendu' };
  return {
    mode,
    apply: !!get('apply'),
    backupConfirmed: !!get('backup-confirmed'),
    confirmCount,
  };
}

export interface CommandResult {
  exitCode: number; // 0 ok · 1 arguments · 2 refus de sécurité · 3 incohérence après écriture
  output: Record<string, unknown>;
}

/**
 * 1. simulation TOUJOURS exécutée d'abord ;
 * 2. sans --apply : rapport de simulation, rien d'autre ;
 * 3. avec --apply : refus si un seul bloqueur (gel, trousseau, sauvegarde,
 *    valeurs illisibles, --confirm ≠ lignes prévues) ; sinon écriture puis
 *    NOUVELLE simulation de contrôle, qui doit prévoir 0 ligne.
 */
export async function executeBackfill(
  argv: string[],
  env: NodeJS.ProcessEnv,
  supabase: Client,
  now: Date = new Date(),
  freezeUntil: Date = FREEZE_UNTIL
): Promise<CommandResult> {
  const args = parseArgs(argv);
  if ('error' in args) return { exitCode: 1, output: { error: args.error } };

  const dryRun = await runBackfill(supabase, { mode: args.mode, apply: false, env });
  if (!args.apply) return { exitCode: 0, output: { simulation: dryRun } };

  const blockers = applyBlockers({
    mode: args.mode,
    env,
    now,
    freezeUntil,
    backupConfirmed: args.backupConfirmed,
    confirmCount: args.confirmCount,
    dryRun,
  });
  if (blockers.length > 0) {
    return { exitCode: 2, output: { refused: blockers, simulation: dryRun } };
  }

  const applied = await runBackfill(supabase, { mode: args.mode, apply: true, env });
  const verification = await runBackfill(supabase, { mode: args.mode, apply: false, env });
  const consistent = verification.totals.planned === applied.totals.conflicts;
  return {
    exitCode: consistent ? 0 : 3,
    output: { applied, verification, consistent },
  };
}

/**
 * Cible EXPLICITE obligatoire avant tout accès base, simulation comprise.
 *
 * Constat (2026-09-24) : `vite-node` charge automatiquement `.env.local` ;
 * lancé « sans variables », le script a quand même atteint la base de
 * production (simulation en lecture seule, aucune écriture). Désormais
 * l'opérateur doit nommer la base visée : `--target=<ref du projet>`, qui
 * doit correspondre à l'hôte de NEXT_PUBLIC_SUPABASE_URL (<ref>.supabase.co).
 */
export function checkTarget(url: string | undefined, argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith('--target='));
  if (!arg)
    return '--target=<ref du projet Supabase> obligatoire (aucun accès base sans cible explicite)';
  const target = arg.slice('--target='.length).trim();
  let host = '';
  try {
    host = new URL(url ?? '').hostname;
  } catch {
    return 'NEXT_PUBLIC_SUPABASE_URL invalide ou absente';
  }
  if (!target || host.split('.')[0] !== target) {
    return '--target ne correspond pas à NEXT_PUBLIC_SUPABASE_URL : arrêt';
  }
  return null;
}
