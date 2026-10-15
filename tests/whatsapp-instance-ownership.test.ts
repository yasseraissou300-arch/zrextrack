// RLS-TENANT-001 — le serveur n'agit jamais (clé Evolution de la plateforme)
// sur une instance hors de l'espace de noms du tenant authentifié.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const logEvent = vi.fn((..._args: unknown[]) => undefined);
vi.mock('@/lib/security/safe-log', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import {
  instanceNameFor,
  isOwnedInstanceName,
  ownedInstance,
  ownerRowOf,
} from '@/lib/whatsapp/instance-ownership';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const A_AUTO = instanceNameFor(A, 'auto_confirmation');
const B_AUTO = instanceNameFor(B, 'auto_confirmation');

describe('isOwnedInstanceName', () => {
  it('1. tenant A → sa propre instance (tous services + format historique) : PASS', () => {
    expect(A_AUTO).toBe('zrex_111111111111_auto');
    for (const s of ['auto_confirmation', 'sav', 'tracking'] as const)
      expect(isOwnedInstanceName(A, instanceNameFor(A, s))).toBe(true);
    expect(isOwnedInstanceName(A, 'zrex_111111111111')).toBe(true);
  });

  it('2. tenant A → instance de B : FAIL', () => {
    expect(isOwnedInstanceName(A, B_AUTO)).toBe(false);
    expect(isOwnedInstanceName(A, instanceNameFor(B, 'sav'))).toBe(false);
  });

  it('3. tenant A → nom hors motif (instance Evolution inconnue, ancien nom) : FAIL', () => {
    for (const n of [
      'legacy_name',
      '1111_sav',
      'zrex_1111111111',
      'zrex_111111111111x',
      'ZREX_111111111111_auto',
    ])
      expect(isOwnedInstanceName(A, n)).toBe(false);
  });

  it('4-5. instance_name null / vide / non-chaîne : FAIL', () => {
    for (const n of [null, undefined, '', 42, {}]) expect(isOwnedInstanceName(A, n)).toBe(false);
  });

  it('injection dans le chemin Evolution (suffixe non alphabétique) : FAIL', () => {
    for (const n of [
      `${A_AUTO}/../${B_AUTO}`,
      'zrex_111111111111_auto?x=1',
      'zrex_111111111111_',
      'zrex_111111111111_au to',
      `zrex_111111111111_${'a'.repeat(3)}%2F`,
    ])
      expect(isOwnedInstanceName(A, n)).toBe(false);
  });

  it('tenant id invalide : FAIL', () => {
    expect(isOwnedInstanceName('', A_AUTO)).toBe(false);
    expect(isOwnedInstanceName('abc', 'zrex_abc')).toBe(false);
  });
});

describe('ownedInstance', () => {
  it('renvoie la ligne possédée, null + journal sans le nom sinon', () => {
    logEvent.mockClear();
    expect(ownedInstance(A, { instance_name: A_AUTO, connected: true }, 't')).toEqual({
      instance_name: A_AUTO,
      connected: true,
    });
    expect(ownedInstance(A, { instance_name: B_AUTO }, 'scope.x')).toBeNull();
    expect(logEvent).toHaveBeenCalledWith('warn', 'scope.x', {
      status: 'rejected',
      reason: 'foreign_instance_name',
      tenant_id: A,
    });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(B_AUTO);
    expect(ownedInstance(A, null, 't')).toBeNull();
    expect(ownedInstance(A, { instance_name: '' }, 't')).toBeNull();
  });
});

describe('10. webhook entrant — ownerRowOf', () => {
  it('ligne de A portant le nom de B : les messages de B ne vont JAMAIS à A', () => {
    expect(ownerRowOf([{ user_id: A, service_type: 'auto_confirmation' }], B_AUTO)).toBeNull();
  });
  it('doublon (A a copié le nom de B) : la résolution va au propriétaire B, sans erreur', () => {
    const rows = [
      { user_id: A, service_type: 'auto_confirmation' },
      { user_id: B, service_type: 'auto_confirmation' },
    ];
    expect(ownerRowOf(rows, B_AUTO)?.user_id).toBe(B);
  });
  it('aucune ligne / nom inconnu → null', () => {
    expect(ownerRowOf([], A_AUTO)).toBeNull();
    expect(ownerRowOf(null, A_AUTO)).toBeNull();
  });
});

// Garde de non-régression : toute lecture d'instance_name en vue d'un appel
// Evolution passe par le contrôle de propriété.
describe('inventaire — chaque lecture de whatsapp_instances.instance_name est contrôlée', () => {
  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : [];
    });
  }
  // Lectures sans appel Evolution (affichage de SES lignes, état « connecté »).
  const EXEMPT = new Set([
    'src/app/api/ai-chatbot/whatsapp/instance/route.ts', // liste ses lignes ; noms calculés côté serveur
    'src/app/api/onboarding/state/route.ts', // lit `connected` seulement
  ]);

  it('aucun fichier ne lit instance_name sans ownedInstance / isOwnedInstanceName / ownerRowOf', () => {
    const offenders: string[] = [];
    for (const f of files(path.join(process.cwd(), 'src'))) {
      const rel = path.relative(process.cwd(), f).split(path.sep).join('/');
      if (EXEMPT.has(rel) || rel.endsWith('instance-ownership.ts')) continue;
      const src = fs.readFileSync(f, 'utf8');
      const readsInstance =
        /from\('whatsapp_instances'\)[\s\S]{0,200}?select\([^)]*instance_name/.test(src);
      if (readsInstance && !/ownedInstance\(|isOwnedInstanceName\(|ownerRowOf\(/.test(src))
        offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
