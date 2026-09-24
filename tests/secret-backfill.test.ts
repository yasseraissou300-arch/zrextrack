// P2-9 phase 3 — migration des secrets (chiffrement) et retour arrière.
// Données SYNTHÉTIQUES uniquement ; trousseaux générés à l'exécution.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import { isSealed, open, seal, secretContext } from '@/lib/security/secret-box';
import {
  runBackfill,
  executeBackfill,
  parseArgs,
  SECRET_FIELDS,
  checkTarget,
} from '@/lib/security/secret-backfill';
import { openZrToken, zrTokenContext } from '@/lib/zrexpress/credentials';
import { openCredential } from '@/lib/user-creds';
import { openPageToken, openPendingPages } from '@/lib/security/facebook-verify';

const key = () => crypto.randomBytes(32).toString('base64');
const K1 = key();
const K2 = key();
const env = (ring?: string) =>
  (ring === undefined ? {} : { SECRETS_KEYRING: ring }) as unknown as NodeJS.ProcessEnv;
const RING1 = env(`k1:${K1}`);
const RING21 = env(`k2:${K2},k1:${K1}`);
const RING2 = env(`k2:${K2}`);

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
// Secrets SYNTHÉTIQUES.
const ZR1 = 'synthetic-zr-key-user1-000000000001';
const ZR2 = 'synthetic-zr-key-user2-000000000002';
const GEM = 'synthetic-gemini-a-0001\nsynthetic-gemini-b-0002';
const FBT = 'synthetic-fb-page-token-0000000003';
const PEND = JSON.stringify([{ id: 'p1', access_token: 'synthetic-fb-pending-0004' }]);
const ALL_PLAIN = [ZR1, ZR2, GEM, FBT, PEND, 'synthetic-fb-pending-0004'];

let db: FakeSupabase;

function seedPlaintext() {
  db.seed('public', 'user_sync_settings', [
    { user_id: U1, zrexpress_token: ZR1, zrexpress_tenant_id: 't1' },
    { user_id: U2, zrexpress_token: ZR2, zrexpress_tenant_id: 't2' },
    { user_id: '33333333-3333-4333-8333-333333333333', zrexpress_token: null },
  ]);
  db.seed('public', 'user_api_credentials', [
    { user_id: U1, service: 'gemini', api_key: GEM, api_secret: null, is_active: true },
  ]);
  db.seed('public', 'facebook_connections', [
    { user_id: U1, page_access_token: FBT, pending_pages: PEND },
  ]);
}

const zr = (u: string) =>
  db.all('public', 'user_sync_settings').find((r) => r.user_id === u)!.zrexpress_token as string;

/** L'application (code réel) lit-elle les valeurs migrées ? */
function appReadsEverything(ringEnv: NodeJS.ProcessEnv) {
  vi.stubEnv('SECRETS_KEYRING', ringEnv.SECRETS_KEYRING ?? '');
  expect(openZrToken(U1, zr(U1))).toBe(ZR1);
  expect(openZrToken(U2, zr(U2))).toBe(ZR2);
  const cred = db.all('public', 'user_api_credentials')[0];
  expect(openCredential(U1, 'gemini', 'api_key', cred.api_key)).toBe(GEM);
  const fb = db.all('public', 'facebook_connections')[0];
  expect(openPageToken(U1, fb.page_access_token)).toBe(FBT);
  expect(openPendingPages(U1, fb.pending_pages)).toBe(PEND);
}

function noSecretIn(value: unknown) {
  const text = JSON.stringify(value);
  for (const p of ALL_PLAIN) expect(text).not.toContain(p);
  expect(text).not.toContain('enc:v1');
  expect(text).not.toContain(K1);
  expect(text).not.toContain(K2);
}

beforeEach(() => {
  db = new FakeSupabase();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('registre', () => {
  it('les contextes du backfill sont IDENTIQUES à ceux de l’application', () => {
    const zrField = SECRET_FIELDS.find((f) => f.column === 'zrexpress_token')!;
    expect(zrField.context({ user_id: U1 })).toBe(zrTokenContext(U1));
    const sealed = seal('x', SECRET_FIELDS[1].context({ user_id: U1, service: 'gemini' }), RING1);
    vi.stubEnv('SECRETS_KEYRING', `k1:${K1}`);
    expect(openCredential(U1, 'gemini', 'api_key', sealed)).toBe('x');
  });
});

describe('simulation (défaut)', () => {
  it('compte sans RIEN écrire', async () => {
    seedPlaintext();
    const before = JSON.stringify(db.all('public', 'user_sync_settings'));
    const r = await runBackfill(db as never, { mode: 'encrypt', apply: false, env: RING1 });
    expect(r.totals.planned).toBe(5); // 2 ZR + 1 Gemini + page token + pending
    expect(r.totals.written).toBe(0);
    expect(JSON.stringify(db.all('public', 'user_sync_settings'))).toBe(before);
    expect(db.writes.filter((w) => w.op === 'update')).toHaveLength(0);
  });

  it('le rapport ne contient AUCUNE valeur', async () => {
    seedPlaintext();
    noSecretIn(await runBackfill(db as never, { mode: 'encrypt', apply: false, env: RING1 }));
  });
});

describe('clair → chiffré → clair', () => {
  it('encrypt : toutes les valeurs chiffrées, lisibles par le code applicatif', async () => {
    seedPlaintext();
    const r = await runBackfill(db as never, { mode: 'encrypt', apply: true, env: RING1 });
    expect(r.totals).toMatchObject({ planned: 5, written: 5, conflicts: 0, unreadable: 0 });
    expect(isSealed(zr(U1)) && isSealed(zr(U2))).toBe(true);
    appReadsEverything(RING1);
    noSecretIn(r);
  });

  it('decrypt (retour arrière) : restitue exactement le clair d’origine', async () => {
    seedPlaintext();
    await runBackfill(db as never, { mode: 'encrypt', apply: true, env: RING1 });
    const r = await runBackfill(db as never, { mode: 'decrypt', apply: true, env: RING1 });
    expect(r.totals.written).toBe(5);
    expect(zr(U1)).toBe(ZR1);
    expect(db.all('public', 'user_api_credentials')[0].api_key).toBe(GEM);
    expect(db.all('public', 'facebook_connections')[0].pending_pages).toBe(PEND);
    noSecretIn(r); // le clair n'existe que côté serveur, jamais dans le rapport
  });

  it('pas de double chiffrement / idempotence : une 2e passe ne prévoit rien', async () => {
    seedPlaintext();
    await runBackfill(db as never, { mode: 'encrypt', apply: true, env: RING1 });
    const snapshot = zr(U1);
    const again = await runBackfill(db as never, { mode: 'encrypt', apply: true, env: RING1 });
    expect(again.totals).toMatchObject({ planned: 0, written: 0 });
    expect(zr(U1)).toBe(snapshot);
    expect(open(zr(U1), zrTokenContext(U1), RING1).value).toBe(ZR1); // un seul niveau
  });
});

describe('trousseau absent ou incorrect', () => {
  it('absent : simulation = clair compté, rien de prévu ; mode réel refusé', async () => {
    seedPlaintext();
    const r = await runBackfill(db as never, { mode: 'encrypt', apply: false, env: env() });
    expect(r.totals.planned).toBe(0);
    expect(r.fields[0].plaintext).toBe(2);
    expect(r.totals.unreadable).toBe(0);
    const cmd = await executeBackfill(
      ['--mode=encrypt', '--apply', '--backup-confirmed', '--confirm=0'],
      env(),
      db as never,
      new Date('2026-10-01T00:00:00Z')
    );
    expect(cmd.exitCode).toBe(2);
    expect(JSON.stringify(cmd.output)).toContain('SECRETS_KEYRING absent');
    expect(zr(U1)).toBe(ZR1);
  });

  it('mauvais kid (clé absente du trousseau) : illisible, jamais écrit, mode réel refusé', async () => {
    seedPlaintext();
    db.all('public', 'user_sync_settings')[0].zrexpress_token = seal(
      ZR1,
      zrTokenContext(U1),
      env(`k9:${key()}`)
    );
    const stored = zr(U1);
    const r = await runBackfill(db as never, { mode: 'encrypt', apply: false, env: RING1 });
    expect(r.fields[0].unreadable).toBe(1);
    expect(r.fields[0].errors.unknown_key).toBe(1);
    const cmd = await executeBackfill(
      ['--mode=encrypt', '--apply', '--backup-confirmed', `--confirm=${r.totals.planned}`],
      RING1,
      db as never,
      new Date('2026-10-01T00:00:00Z')
    );
    expect(cmd.exitCode).toBe(2);
    expect(zr(U1)).toBe(stored);
    noSecretIn(cmd.output);
  });
});

describe('rotation', () => {
  it('k1 → k2 : valeurs « stale » re-chiffrées, k1 retirable ensuite', async () => {
    seedPlaintext();
    await runBackfill(db as never, { mode: 'encrypt', apply: true, env: RING1 });
    const r = await runBackfill(db as never, { mode: 'encrypt', apply: true, env: RING21 });
    expect(r.fields[0].sealed_stale).toBe(2);
    expect(r.totals.written).toBe(5);
    expect(zr(U1).startsWith('enc:v1:k2:')).toBe(true);
    appReadsEverything(RING2); // k1 retiré : tout reste lisible
  });
});

describe('interruption et reprise', () => {
  it('coupure au milieu : chaque ligne est soit l’ancien clair soit un chiffré valide ; la relance termine', async () => {
    seedPlaintext();
    let updates = 0;
    const crashing = {
      from(table: string) {
        const b = db.from(table) as unknown as { update: (p: unknown) => unknown };
        const orig = b.update.bind(b);
        b.update = (p: unknown) => {
          if (++updates > 2) throw new Error('coupure simulée');
          return orig(p);
        };
        return b;
      },
    };
    await expect(
      runBackfill(crashing as never, { mode: 'encrypt', apply: true, env: RING1 })
    ).rejects.toThrow('coupure simulée');

    // Invariant : aucune valeur perdue ni corrompue pendant la coupure.
    for (const [u, plain] of [
      [U1, ZR1],
      [U2, ZR2],
    ] as const) {
      const v = zr(u);
      expect(v === plain || open(v, zrTokenContext(u), RING1).value === plain).toBe(true);
    }

    const resume = await runBackfill(db as never, { mode: 'encrypt', apply: true, env: RING1 });
    expect(resume.totals.written).toBe(3); // 5 - 2 déjà faits
    const done = await runBackfill(db as never, { mode: 'encrypt', apply: false, env: RING1 });
    expect(done.totals.planned).toBe(0);
    appReadsEverything(RING1);
  });

  it('valeur modifiée entre lecture et écriture (nouvelle clé saisie) : jamais écrasée', async () => {
    seedPlaintext();
    const realFrom = db.from.bind(db);
    let raced = false;
    const racing = {
      from(table: string) {
        const b = realFrom(table) as unknown as { update: (p: unknown) => unknown };
        const orig = b.update.bind(b);
        b.update = (p: unknown) => {
          if (!raced && table === 'user_sync_settings') {
            raced = true;
            db.all('public', 'user_sync_settings')[0].zrexpress_token = 'synthetic-new-key-by-user';
          }
          return orig(p);
        };
        return b;
      },
    };
    const r = await runBackfill(racing as never, { mode: 'encrypt', apply: true, env: RING1 });
    expect(r.totals.conflicts).toBe(1);
    expect(db.all('public', 'user_sync_settings')[0].zrexpress_token).toBe(
      'synthetic-new-key-by-user'
    );
  });
});

describe('conditions du mode réel', () => {
  const AFTER = new Date('2026-10-01T00:00:00Z');

  it('pendant le gel : REFUS, même avec tout le reste correct', async () => {
    seedPlaintext();
    const cmd = await executeBackfill(
      ['--mode=encrypt', '--apply', '--backup-confirmed', '--confirm=5'],
      RING1,
      db as never,
      new Date('2026-09-25T12:00:00Z')
    );
    expect(cmd.exitCode).toBe(2);
    expect(JSON.stringify(cmd.output)).toContain('gel de production');
    expect(zr(U1)).toBe(ZR1);
  });

  it('sans --backup-confirmed, ou --confirm absent / différent : REFUS', async () => {
    seedPlaintext();
    for (const argv of [
      ['--mode=encrypt', '--apply', '--confirm=5'],
      ['--mode=encrypt', '--apply', '--backup-confirmed'],
      ['--mode=encrypt', '--apply', '--backup-confirmed', '--confirm=4'],
    ]) {
      const cmd = await executeBackfill(argv, RING1, db as never, AFTER);
      expect(cmd.exitCode).toBe(2);
    }
    expect(zr(U1)).toBe(ZR1);
  });

  it('tout est satisfait : écriture puis simulation de contrôle à 0', async () => {
    seedPlaintext();
    const cmd = await executeBackfill(
      ['--mode=encrypt', '--apply', '--backup-confirmed', '--confirm=5'],
      RING1,
      db as never,
      AFTER
    );
    expect(cmd.exitCode).toBe(0);
    expect(cmd.output.consistent).toBe(true);
    noSecretIn(cmd.output);
  });

  it('sans --apply : simulation uniquement, quel que soit le reste', async () => {
    seedPlaintext();
    const cmd = await executeBackfill(['--mode=encrypt'], RING1, db as never, AFTER);
    expect(cmd.exitCode).toBe(0);
    expect(cmd.output.simulation).toBeDefined();
    expect(zr(U1)).toBe(ZR1);
  });

  it('arguments invalides', () => {
    expect(parseArgs([])).toHaveProperty('error');
    expect(parseArgs(['--mode=delete'])).toHaveProperty('error');
    expect(parseArgs(['--mode=encrypt', '--confirm=abc'])).toHaveProperty('error');
  });
});

describe('robustesse', () => {
  it('table absente : comptée en erreur de lecture, les autres champs continuent', async () => {
    seedPlaintext();
    db.failNext('public', 'facebook_connections', 'select', { code: 'PGRST205' });
    const r = await runBackfill(db as never, { mode: 'encrypt', apply: false, env: RING1 });
    const fb = r.fields.find((f) => f.field === 'facebook_connections.page_access_token')!;
    expect(fb.errors['read:PGRST205']).toBe(1);
    expect(r.fields[0].planned).toBe(2);
  });

  it('aucune écriture console contenant une valeur', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    );
    seedPlaintext();
    await runBackfill(db as never, { mode: 'encrypt', apply: true, env: RING1 });
    await runBackfill(db as never, { mode: 'decrypt', apply: true, env: env(`k1:${key()}`) });
    for (const s of spies) for (const call of s.mock.calls) noSecretIn(call);
  });
});

it('secretContext est bien celui du module (garde-fou d’import)', () => {
  expect(secretContext('a', 'b', 'c')).toBe('a.b:c');
});

describe('cible explicite (--target) avant tout accès base', () => {
  const URL_OK = 'https://abcdefghijklmnop.supabase.co';
  it('absente → refus', () => {
    expect(checkTarget(URL_OK, ['--mode=encrypt'])).toMatch(/obligatoire/);
  });
  it('différente de l’hôte → refus', () => {
    expect(checkTarget(URL_OK, ['--target=autreprojet'])).toMatch(/ne correspond pas/);
  });
  it('URL absente ou invalide → refus', () => {
    expect(checkTarget(undefined, ['--target=abcdefghijklmnop'])).toMatch(/invalide/);
  });
  it('correspondance exacte → autorisé', () => {
    expect(checkTarget(URL_OK, ['--target=abcdefghijklmnop'])).toBeNull();
  });
});
