// Commandes à confirmer depuis un Google Sheet : reconnaissance des colonnes,
// montants, import idempotent, changements de statut, isolation des comptes.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import {
  detectColumns,
  parseAmount,
  parseDeliveryType,
  parseSheet,
  sheetIdFromUrl,
} from '@/lib/inbox/sheet-parse';
import {
  canMoveTo,
  getSource,
  importFromSheet,
  listInbox,
  saveSource,
  setInboxStatus,
  type FetchValues,
} from '@/lib/inbox/store';

describe('detectColumns', () => {
  it('en-têtes arabes (formulaire de landing page)', () => {
    const m = detectColumns([
      'التاريخ',
      'الاسم الكامل',
      'رقم الهاتف',
      'الولاية',
      'البلدية',
      'المنتج',
      'الكمية',
      'السعر',
    ]);
    expect(m).toEqual({
      ordered_at: 0,
      customer_name: 1,
      phone: 2,
      wilaya: 3,
      commune: 4,
      product: 5,
      quantity: 6,
      price: 7,
    });
  });

  it('en-têtes français / anglais, « prix livraison » n’est pas le prix', () => {
    const m = detectColumns([
      'Nom',
      'Téléphone',
      'Wilaya',
      'Prix livraison',
      'Total',
      'Type de livraison',
      'Product',
    ]);
    expect(m.customer_name).toBe(0);
    expect(m.phone).toBe(1);
    expect(m.price).toBe(4);
    expect(m.delivery_type).toBe(5);
    expect(m.product).toBe(6);
  });
});

describe('parseAmount / parseDeliveryType', () => {
  it('montants écrits de plusieurs façons', () => {
    expect(parseAmount('3 200 DA')).toBe(3200);
    expect(parseAmount('3200.00')).toBe(3200);
    expect(parseAmount('3,200')).toBe(3200);
    expect(parseAmount('3.200')).toBe(3200);
    expect(parseAmount('3200,50')).toBe(3200.5);
    expect(parseAmount('٣٢٠٠ دج')).toBe(3200);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('gratuit')).toBe(0);
  });

  it('stop desk / bureau / مكتب → stopdesk, le reste → domicile', () => {
    expect(parseDeliveryType('Stop Desk')).toBe('stopdesk');
    expect(parseDeliveryType('Bureau ZR')).toBe('stopdesk');
    expect(parseDeliveryType('المكتب')).toBe('stopdesk');
    expect(parseDeliveryType('A domicile')).toBe('domicile');
    expect(parseDeliveryType('')).toBe('domicile');
  });
});

describe('parseSheet', () => {
  const header = ['Nom', 'Téléphone', 'Wilaya', 'Produit', 'Prix'];

  it('lignes valides importées, téléphone invalide ignoré, lignes vides sautées', () => {
    const r = parseSheet([
      header,
      ['Amine', '0550 12 34 56', 'Oran', 'Veste EMY', '3 200'],
      ['', '', '', '', ''],
      ['Sara', '123', 'Alger', 'Robe', '2500'],
    ]);
    expect(r.missing).toEqual([]);
    expect(r.skipped).toBe(1);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({
      customer_name: 'Amine',
      phone: '213550123456',
      wilaya: 'Oran',
      product: 'Veste EMY',
      price: 3200,
      quantity: 1,
      delivery_type: 'domicile',
    });
  });

  it('même ligne = même empreinte, ligne différente = autre empreinte', () => {
    const a = parseSheet([header, ['Amine', '0550123456', 'Oran', 'Veste', '3200']]).drafts[0];
    const b = parseSheet([header, ['Amine', '0550123456', 'Oran', 'Veste', '3200']]).drafts[0];
    const c = parseSheet([header, ['Amine', '0550123456', 'Oran', 'Veste', '3300']]).drafts[0];
    expect(a.external_ref).toBe(b.external_ref);
    expect(a.external_ref).not.toBe(c.external_ref);
  });

  it('sans colonne téléphone : rien n’est importé et le champ manquant est signalé', () => {
    const r = parseSheet([
      ['Nom', 'Produit'],
      ['Amine', 'Veste'],
    ]);
    expect(r.missing).toEqual(['phone']);
    expect(r.drafts).toEqual([]);
  });
});

describe('sheetIdFromUrl', () => {
  it('lien de partage ou ID seul', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    expect(sheetIdFromUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`)).toBe(id);
    expect(sheetIdFromUrl(id)).toBe(id);
    expect(sheetIdFromUrl('https://evil.example/x')).toBeNull();
    expect(sheetIdFromUrl('')).toBeNull();
  });
});

const fake = new FakeSupabase();
const svc = fake as any;
const SHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const values = [
  ['Nom', 'Téléphone', 'Wilaya', 'Produit', 'Prix'],
  ['Amine', '0550123456', 'Oran', 'Veste EMY', '3200'],
  ['Sara', '0661987654', 'Alger', 'Robe', '2500'],
];
const okFetch: FetchValues = async () => ({ ok: true, values });

describe('importFromSheet', () => {
  beforeEach(() => fake.reset());

  it('sans Sheet configuré → no_sheet', async () => {
    expect((await importFromSheet(svc, 'T1', okFetch)).reason).toBe('no_sheet');
  });

  it('import puis ré-import : aucune commande en double, statuts conservés', async () => {
    await saveSource(svc, 'T1', { sheet_id: SHEET });
    const first = await importFromSheet(svc, 'T1', okFetch, 1_000_000);
    expect(first).toMatchObject({ ok: true, imported: 2 });

    const board = await listInbox(svc, 'T1');
    const amine = board!.orders.find((o) => o.customer_name === 'Amine')!;
    expect(await setInboxStatus(svc, 'T1', amine.id, 'confirmed')).toBe('ok');

    // 2e import plus d'une minute après : rien de nouveau, Amine reste confirmé
    const second = await importFromSheet(svc, 'T1', okFetch, 1_000_000 + 61_000);
    expect(second).toMatchObject({ ok: true, imported: 0 });
    const after = await listInbox(svc, 'T1');
    expect(after!.orders).toHaveLength(2);
    expect(after!.orders.find((o) => o.id === amine.id)!.status).toBe('confirmed');
  });

  it('pas plus d’un import par minute', async () => {
    await saveSource(svc, 'T1', { sheet_id: SHEET });
    await importFromSheet(svc, 'T1', okFetch, 1_000_000);
    expect((await importFromSheet(svc, 'T1', okFetch, 1_030_000)).reason).toBe('too_soon');
  });

  it('Sheet non partagé → no_access, rien d’importé', async () => {
    await saveSource(svc, 'T1', { sheet_id: SHEET });
    const r = await importFromSheet(svc, 'T1', async () => ({ ok: false, reason: 'no_access' }));
    expect(r).toMatchObject({ ok: false, reason: 'no_access', imported: 0 });
    expect((await getSource(svc, 'T1'))!.last_import_status).toBe('no_access');
  });

  it('table absente (migration non exécutée) → unavailable, sans erreur', async () => {
    fake.failNext('autotim', 'order_sources', 'select', { code: '42P01' });
    expect((await importFromSheet(svc, 'T1', okFetch)).reason).toBe('unavailable');
  });
});

describe('statuts et isolation', () => {
  beforeEach(() => fake.reset());

  it('transitions manuelles autorisées / interdites', () => {
    expect(canMoveTo('new', 'confirmed')).toBe(true);
    expect(canMoveTo('confirming', 'cancelled')).toBe(true);
    expect(canMoveTo('cancelled', 'new')).toBe(true);
    // « sent » ne se pose jamais à la main, et une commande expédiée ne bouge plus
    expect(canMoveTo('confirmed', 'sent')).toBe(false);
    expect(canMoveTo('sent', 'cancelled')).toBe(false);
  });

  it('un compte ne voit ni ne modifie les commandes d’un autre', async () => {
    await saveSource(svc, 'T1', { sheet_id: SHEET });
    await importFromSheet(svc, 'T1', okFetch, 1_000_000);
    const id = (await listInbox(svc, 'T1'))!.orders[0].id;

    expect((await listInbox(svc, 'T2'))!.orders).toEqual([]);
    expect(await setInboxStatus(svc, 'T2', id, 'cancelled')).toBe('not_found');
    expect((await listInbox(svc, 'T1'))!.orders.find((o) => o.id === id)!.status).toBe('new');
  });

  it('« sent » refusé à la main', async () => {
    expect(await setInboxStatus(svc, 'T1', 'x', 'sent')).toBe('forbidden');
  });
});

describe('detectColumns — « livraison »', () => {
  it('« Livraison » seul = type de livraison ; « Adresse de livraison » = adresse', () => {
    const m = detectColumns(['Nom', 'Téléphone', 'Adresse de livraison', 'Livraison']);
    expect(m.address).toBe(2);
    expect(m.delivery_type).toBe(3);
  });
});
