// sync-diff — ce qui est significatif, champ par champ.
//
// Garanties verrouillées :
//   - chaque colonne métier écrite par le sync, modifiée SEULE, déclenche une
//     écriture (aucune mise à jour réelle perdue) ;
//   - des valeurs équivalentes (null / '', 1500 / '1500') ne réécrivent rien ;
//   - last_update : comparé seulement quand c'est une date ZR (pas l'instant du
//     sync), en instants (formats différents, même instant = inchangé) ;
//   - l'existant est lu par tenant (aucune collision de numéro de suivi) ;
//   - une écriture en échec est rejouée au passage suivant.

import { describe, it, expect } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import {
  COMPARED_FIELDS,
  diffOrders,
  loadExistingOrders,
  statusChanged,
  upsertOrdersInChunks,
  type ExistingOrder,
} from '@/lib/zrexpress/sync-diff';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SYNCED = '2026-10-13T10:00:00.000Z';

const base = {
  tracking_number: 'ZR-1',
  customer_name: 'Amine B',
  customer_whatsapp: '0550123456',
  wilaya: 'Oran',
  product_name: 'Montre',
  cod: 1500,
  delivery_status: 'en_livraison',
  attempts: 1,
  last_update: SYNCED,
};

const existingOf = (over: Partial<ExistingOrder> = {}) =>
  new Map<string, ExistingOrder>([
    ['ZR-1', { ...base, last_update: '2026-10-12T08:00:00+00:00', ...over } as ExistingOrder],
  ]);

const CHANGES: Record<(typeof COMPARED_FIELDS)[number], unknown> = {
  customer_name: 'Amine Benali',
  customer_whatsapp: '0661000000',
  wilaya: 'Alger',
  product_name: 'Montre noire',
  cod: 1800,
  delivery_status: 'livre',
  attempts: 2,
};

describe('changement réel → toujours écrit', () => {
  it.each(COMPARED_FIELDS.map((f) => [f]))('%s modifié seul → 1 écriture (update)', (f) => {
    const row = { ...base, [f]: CHANGES[f] };
    const d = diffOrders([row], existingOf(), SYNCED);
    expect(d.toWrite).toHaveLength(1);
    expect(d.updated).toBe(1);
  });

  it('nouveau numéro de suivi → création', () => {
    const d = diffOrders([{ ...base, tracking_number: 'ZR-NEW' }], existingOf(), SYNCED);
    expect(d.created).toBe(1);
  });
});

describe('donnée identique → aucune écriture', () => {
  it('tous les champs identiques → 0 écriture', () => {
    expect(diffOrders([base], existingOf(), SYNCED).unchanged).toBe(1);
  });

  it('null en base vs chaîne vide du sync → inchangé', () => {
    const d = diffOrders(
      [{ ...base, customer_whatsapp: '' }],
      existingOf({ customer_whatsapp: null }),
      SYNCED
    );
    expect(d.unchanged).toBe(1);
  });

  it('nombre vs chaîne équivalente (cod 1500 / "1500") → inchangé', () => {
    const d = diffOrders([base], existingOf({ cod: '1500' }), SYNCED);
    expect(d.unchanged).toBe(1);
  });
});

describe('last_update', () => {
  it('instant du sync (pas de date ZR) → ignoré : pas de réécriture', () => {
    const d = diffOrders([{ ...base, last_update: SYNCED }], existingOf(), SYNCED);
    expect(d.unchanged).toBe(1);
  });

  it('date ZR identique, format différent (+00:00 vs .000Z) → inchangé', () => {
    const d = diffOrders(
      [{ ...base, last_update: '2026-10-12T08:00:00.000Z' }],
      existingOf({ last_update: '2026-10-12T08:00:00+00:00' }),
      SYNCED
    );
    expect(d.unchanged).toBe(1);
  });

  it('date ZR changée SEULE (même statut) → écrite', () => {
    const d = diffOrders(
      [{ ...base, last_update: '2026-10-13T09:30:00.000Z' }],
      existingOf({ last_update: '2026-10-12T08:00:00+00:00' }),
      SYNCED
    );
    expect(d.updated).toBe(1);
  });

  it('date ZR présente, base sans date → écrite', () => {
    const d = diffOrders(
      [{ ...base, last_update: '2026-10-13T09:30:00.000Z' }],
      existingOf({ last_update: null }),
      SYNCED
    );
    expect(d.updated).toBe(1);
  });
});

describe('multi-tenant', () => {
  it('le même numéro de suivi chez un autre tenant ne rend pas la commande « inchangée »', async () => {
    const db = new FakeSupabase();
    db.seed('public', 'orders', [{ ...base, id: 1, user_id: B }]);
    const existingA = await loadExistingOrders(db as never, A);
    expect(existingA?.size).toBe(0);
    const d = diffOrders([base], existingA!, SYNCED);
    expect(d.created).toBe(1);
    expect(statusChanged(existingA, base)).toBe(true);
  });
});

describe('reprise après erreur', () => {
  it('écriture en échec → la commande est encore détectée et réécrite au passage suivant', async () => {
    const db = new FakeSupabase();
    const row = { ...base, user_id: A };
    db.failNext('public', 'orders', 'upsert');
    const first = await upsertOrdersInChunks(db as never, [row]);
    expect(first.error).not.toBeNull();
    expect(first.written).toBe(0);

    const existing = await loadExistingOrders(db as never, A);
    const d = diffOrders([row], existing!, SYNCED);
    expect(d.toWrite).toHaveLength(1);
    const second = await upsertOrdersInChunks(db as never, d.toWrite);
    expect(second).toEqual({ written: 1, error: null });
  });
});
