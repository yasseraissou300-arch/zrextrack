// Envoi à ZRExpress : rapprochement wilaya / commune, requête de création,
// une seule création par commande, isolation entre comptes.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import {
  communesOf,
  matchCommune,
  matchWilaya,
  normPlace,
  wilayasOf,
  type Territory,
} from '@/lib/zrexpress/territories';
import {
  buildParcelRequest,
  SENDING_MARK,
  shipInboxOrder,
  validateChoice,
  type CreateParcel,
  type ShipChoice,
} from '@/lib/inbox/ship';

const W_ORAN = '11111111-1111-4111-8111-000000000031';
const W_ALGER = '11111111-1111-4111-8111-000000000016';
const C_BIR = '22222222-2222-4222-8222-000000000001';
const C_ORAN = '22222222-2222-4222-8222-000000000002';
const C_BAB = '22222222-2222-4222-8222-000000000003';
const HUB = '33333333-3333-4333-8333-000000000001';

const T = (
  id: string,
  name: string,
  ar: string,
  parentId: string | null,
  code: number | null = null
): Territory => ({
  id,
  code,
  name,
  nameArabic: ar,
  parentId,
  hasHomeDelivery: true,
  hasPickupPoint: true,
});

const ALL: Territory[] = [
  T(W_ORAN, 'Oran', 'وهران', null, 31),
  T(W_ALGER, 'Alger', 'الجزائر', null, 16),
  T(C_BIR, 'Bir El Djir', 'بئر الجير', W_ORAN),
  T(C_ORAN, 'Oran', 'وهران', W_ORAN),
  T(C_BAB, 'Bab El Oued', 'باب الوادي', W_ALGER),
];

describe('rapprochement des territoires', () => {
  it('wilayas et communes', () => {
    expect(wilayasOf(ALL).map((w) => w.name)).toEqual(['Alger', 'Oran']);
    expect(communesOf(ALL, W_ORAN).map((c) => c.name)).toEqual(['Bir El Djir', 'Oran']);
  });

  it('wilaya par code, nom latin, nom arabe, « 31 - Oran »', () => {
    for (const s of ['31', '31 - Oran', 'oran', 'ORAN', 'وهران', "Wilaya d'Oran"])
      expect(matchWilaya(ALL, s)?.id, s).toBe(W_ORAN);
    expect(matchWilaya(ALL, '16')?.id).toBe(W_ALGER);
    expect(matchWilaya(ALL, 'Tamanrasset')).toBeNull();
  });

  it('commune dans SA wilaya seulement, écritures variées', () => {
    for (const s of ['Bir El Djir', 'bir el djir', 'BIR EL-DJIR', 'بئر الجير'])
      expect(matchCommune(ALL, W_ORAN, s)?.id, s).toBe(C_BIR);
    expect(matchCommune(ALL, W_ALGER, 'Bir El Djir')).toBeNull();
    expect(matchCommune(ALL, W_ORAN, '')).toBeNull();
  });

  it('normPlace', () => {
    expect(normPlace('Aïn Témouchent')).toBe('ain temouchent');
    expect(normPlace('ولاية وهران')).toBe('وهران');
  });
});

const choice: ShipChoice = {
  wilayaId: W_ORAN,
  communeId: C_BIR,
  deliveryType: 'home',
  amount: 3200,
  description: 'Veste EMY × 1',
};

describe('validateChoice / buildParcelRequest', () => {
  it('refuse les choix incomplets', () => {
    expect(validateChoice(choice)).toBeNull();
    expect(validateChoice({ ...choice, communeId: '' })).toBe('Commune manquante');
    expect(validateChoice({ ...choice, deliveryType: 'pickup-point' })).toBe(
      'Choisissez le bureau (stop desk)'
    );
    expect(validateChoice({ ...choice, deliveryType: 'pickup-point', hubId: HUB })).toBeNull();
    expect(validateChoice({ ...choice, amount: -1 })).toBe('Montant invalide');
    expect(validateChoice({ ...choice, wilayaId: 'pas-un-uuid' })).toBe('Wilaya manquante');
  });

  it('requête ZR : téléphone local, territoires, stop desk, référence externe', () => {
    const body = buildParcelRequest(
      {
        id: 'o1',
        status: 'confirmed',
        customer_name: 'Amine',
        phone: '213550123456',
        address: 'Cité 200 logts',
        updated_at: '',
        zr_error: null,
        zr_tracking: null,
      },
      { ...choice, deliveryType: 'pickup-point', hubId: HUB }
    );
    expect(body).toMatchObject({
      customer: { name: 'Amine', phone: { number1: '0550123456' } },
      deliveryAddress: {
        cityTerritoryId: W_ORAN,
        districtTerritoryId: C_BIR,
        street: 'Cité 200 logts',
      },
      deliveryType: 'pickup-point',
      hubId: HUB,
      amount: 3200,
      externalId: 'AT-o1',
    });
  });
});

const fake = new FakeSupabase();
const svc = fake as any;
const auth = { token: 'tok', tenantId: 'zr-tenant' };

describe('shipInboxOrder', () => {
  beforeEach(() => fake.reset());

  const seed = (status = 'confirmed', extra: Record<string, unknown> = {}) =>
    fake.seed('autotim', 'inbox_orders', [
      {
        id: 'o1',
        tenant_id: 'T1',
        status,
        customer_name: 'Amine',
        phone: '213550123456',
        address: '',
        updated_at: '2026-11-25T10:00:00.000Z',
        zr_error: null,
        zr_tracking: null,
        ...extra,
      },
    ]);

  it('commande confirmée → colis créé, statut « envoyée », numéro de suivi', async () => {
    seed();
    const create: CreateParcel = vi.fn(async () => ({ ok: true as const, tracking: 'ZR-123' }));
    expect(await shipInboxOrder(svc, 'T1', 'o1', choice, auth, create)).toEqual({
      ok: true,
      tracking: 'ZR-123',
    });
    expect(fake.all('autotim', 'inbox_orders')[0]).toMatchObject({
      status: 'sent',
      zr_tracking: 'ZR-123',
      zr_error: null,
    });
  });

  it('jamais deux colis pour la même commande', async () => {
    seed();
    const create: CreateParcel = vi.fn(async () => ({ ok: true as const, tracking: 'ZR-123' }));
    await shipInboxOrder(svc, 'T1', 'o1', choice, auth, create);
    expect((await shipInboxOrder(svc, 'T1', 'o1', choice, auth, create)).ok).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('envoi déjà en cours (verrou < 2 min) → refusé sans appel ZR', async () => {
    seed('confirmed', { zr_error: SENDING_MARK, updated_at: new Date().toISOString() });
    const create = vi.fn();
    expect(await shipInboxOrder(svc, 'T1', 'o1', choice, auth, create as any)).toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('seules les commandes confirmées partent', async () => {
    seed('new');
    const create = vi.fn();
    expect((await shipInboxOrder(svc, 'T1', 'o1', choice, auth, create as any)).ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('refus ZR → message gardé, la commande reste confirmée (on peut corriger et réessayer)', async () => {
    seed();
    const create: CreateParcel = vi.fn(async () => ({
      ok: false as const,
      status: 400,
      message: 'District not found',
    }));
    expect(await shipInboxOrder(svc, 'T1', 'o1', choice, auth, create)).toEqual({
      ok: false,
      reason: 'zr_error',
      message: 'District not found',
    });
    expect(fake.all('autotim', 'inbox_orders')[0]).toMatchObject({
      status: 'confirmed',
      zr_error: 'District not found',
    });
    const ok: CreateParcel = vi.fn(async () => ({ ok: true as const, tracking: 'ZR-9' }));
    expect((await shipInboxOrder(svc, 'T1', 'o1', choice, auth, ok)).ok).toBe(true);
  });

  it('un autre compte ne peut pas envoyer la commande', async () => {
    seed();
    const create = vi.fn();
    expect(await shipInboxOrder(svc, 'T2', 'o1', choice, auth, create as any)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(create).not.toHaveBeenCalled();
  });
});
