// Webhook « nouvelle commande » du site du marchand : jeton chiffré, formats
// JSON variés, aucune commande en double, isolation entre marchands.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

const KEYRING = `k1:${randomBytes(32).toString('base64')}`;
process.env.SECRETS_KEYRING = KEYRING;

const fake = new FakeSupabase();
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fake,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

const { flattenOrder, parseWebhookBody, tenantFromToken, webhookToken } =
  await import('@/lib/inbox/webhook');
const { POST } = await import('@/app/api/inbox/webhook/route');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const post = (token: string | null, body: unknown) =>
  POST(
    new NextRequest(
      `https://x.test/api/inbox/webhook${token ? `?token=${encodeURIComponent(token)}` : ''}`,
      {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }
    )
  );

beforeEach(() => fake.reset());

describe('jeton', () => {
  it('aller-retour, et deux jetons différents pour le même marchand restent valides', () => {
    const a = webhookToken(T1)!;
    const b = webhookToken(T1)!;
    expect(a).not.toBe(b);
    expect(tenantFromToken(a)).toBe(T1);
    expect(tenantFromToken(b)).toBe(T1);
  });

  it('identifiant en clair, jeton modifié ou vide → refusé', () => {
    const t = webhookToken(T1)!;
    expect(tenantFromToken(T1)).toBeNull();
    expect(tenantFromToken(t.slice(0, -3) + 'AAA')).toBeNull();
    expect(tenantFromToken('')).toBeNull();
    expect(tenantFromToken(null)).toBeNull();
  });

  it('un jeton d’un autre contexte chiffré (secret stocké) n’est pas un jeton webhook', async () => {
    const { seal } = await import('@/lib/security/secret-box');
    expect(tenantFromToken(seal(T1, 'user_sync_settings.zrexpress_token:x'))).toBeNull();
  });
});

describe('parseWebhookBody', () => {
  it('clés françaises plates', () => {
    const r = parseWebhookBody({
      id: 'CMD-77',
      nom: 'Amine',
      telephone: '0550 12 34 56',
      wilaya: '31 - Oran',
      commune: 'Bir El Djir',
      produit: 'Veste EMY',
      quantite: 2,
      prix: '6 400 DA',
      livraison: 'stop desk',
    });
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({
      external_ref: 'wh:id:CMD-77',
      customer_name: 'Amine',
      phone: '213550123456',
      wilaya: '31 - Oran',
      commune: 'Bir El Djir',
      product: 'Veste EMY',
      quantity: 2,
      price: 6400,
      delivery_type: 'stopdesk',
    });
  });

  it('format type boutique (objets imbriqués, produits en tableau, anglais)', () => {
    const r = parseWebhookBody({
      orders: [
        {
          order_id: 501,
          customer: { name: 'Sara B.', phone: '+213661987654' },
          shipping_address: { province: 'Alger', city: 'Bab El Oued', address1: 'Rue 1' },
          line_items: [{ name: 'Robe Lina', quantity: 1 }],
          total_price: '4500.00',
        },
      ],
    });
    expect(r.drafts[0]).toMatchObject({
      external_ref: 'wh:id:501',
      customer_name: 'Sara B.',
      phone: '213661987654',
      wilaya: 'Alger',
      commune: 'Bab El Oued',
      product: 'Robe Lina × 1',
      price: 4500,
    });
  });

  it('clés arabes, plusieurs commandes, 50 au maximum', () => {
    const one = {
      الاسم: 'أمين',
      'رقم الهاتف': '0550123456',
      الولاية: 'وهران',
      المنتج: 'Veste',
      السعر: 3200,
    };
    expect(parseWebhookBody([one]).drafts[0]).toMatchObject({
      customer_name: 'أمين',
      wilaya: 'وهران',
    });
    expect(parseWebhookBody(Array.from({ length: 80 }, () => one)).received).toBe(50);
  });

  it('sans téléphone → rien, champs manquants signalés', () => {
    const r = parseWebhookBody({ nom: 'Amine', produit: 'Veste' });
    expect(r.drafts).toEqual([]);
    expect(r.missing).toEqual(['phone']);
  });

  it('flattenOrder', () => {
    expect(flattenOrder({ a: { b: 'x' }, items: [{ title: 'T', qty: 3 }], n: null })).toEqual({
      'a b': 'x',
      items: 'T × 3',
    });
  });
});

describe('POST /api/inbox/webhook', () => {
  const order = { id: 'A1', nom: 'Amine', telephone: '0550123456', produit: 'Veste', prix: 3200 };

  it('sans jeton ou jeton invalide → 401, rien d’écrit', async () => {
    expect((await post(null, order)).status).toBe(401);
    expect((await post(T1, order)).status).toBe(401);
    expect(fake.all('autotim', 'inbox_orders')).toEqual([]);
  });

  it('commande reçue → « nouvelle » chez le bon marchand ; renvoi identique ignoré', async () => {
    const token = webhookToken(T1)!;
    const res = await post(token, order);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, received: 1, created: 1 });
    const again = await post(token, order);
    expect(await again.json()).toEqual({ ok: true, received: 1, created: 0 });

    const rows = fake.all('autotim', 'inbox_orders');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: T1,
      status: 'new',
      source: 'manual',
      external_ref: 'wh:id:A1',
    });
  });

  it('isolation : le jeton du marchand 2 écrit chez le marchand 2', async () => {
    await post(webhookToken(T2)!, order);
    expect(fake.all('autotim', 'inbox_orders')[0].tenant_id).toBe(T2);
  });

  it('JSON invalide → 400 ; commande sans téléphone → 422', async () => {
    const token = webhookToken(T1)!;
    expect((await post(token, '{pas du json')).status).toBe(400);
    expect((await post(token, { nom: 'Amine' })).status).toBe(422);
  });
});

describe('TimStore (webhooks sortants de timstore.site)', () => {
  const timstore = (over: Record<string, unknown> = {}) => ({
    event: 'order.created',
    created_at: '2026-11-26T10:00:00+01:00',
    shop: { id: 12, name: 'Boutique Yasser', slug: 'yasser' },
    order: {
      id: 345,
      reference: 'TS-000345',
      status: 'NEW',
      previous_status: null,
      currency: 'DZD',
      subtotal: 5800,
      shipping_price: 600,
      discount_total: 0,
      total: 6400,
      customer: { name: 'Amine Benali', phone: '0550123456', phone2: null },
      shipping: {
        wilaya_id: 31,
        wilaya: 'Oran',
        commune: 'Bir El Djir',
        address: 'Cité 200',
        delivery_type: 'DESK',
      },
      note: 'Appeler après 17h',
      source: 'storefront',
      utm: { utm_source: 'facebook' },
      items: [
        {
          product_id: 1,
          variant_id: 4,
          name: 'Veste EMY',
          variant: '50 / Grenat',
          quantity: 2,
          unit_price: 2900,
          total: 5800,
        },
      ],
      created_at: '2026-11-26T10:00:00+01:00',
      ...over,
    },
  });

  it('nom du CLIENT (pas de la boutique), TOTAL avec livraison, stop desk, produit + variante', () => {
    const r = parseWebhookBody(timstore());
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({
      external_ref: 'wh:id:ts:12:345',
      customer_name: 'Amine Benali',
      phone: '213550123456',
      wilaya: 'Oran',
      commune: 'Bir El Djir',
      address: 'Cité 200',
      product: 'Veste EMY (50 / Grenat) × 2',
      quantity: 2,
      price: 6400,
      delivery_type: 'stopdesk',
    });
    expect(r.drafts[0].note).toContain('TS-000345');
  });

  it('changement de statut et « Tester » sans commande → ignorés (pas d’erreur)', () => {
    expect(parseWebhookBody({ ...timstore(), event: 'order.status_changed' })).toMatchObject({
      drafts: [],
      ignored: true,
    });
    expect(
      parseWebhookBody({ event: 'order.created', shop: { id: 1 }, order: null })
    ).toMatchObject({
      ignored: true,
    });
  });

  it('route : commande TimStore créée une fois ; statut changé → 200 ignoré', async () => {
    const token = webhookToken(T1)!;
    expect(await (await post(token, timstore())).json()).toEqual({
      ok: true,
      received: 1,
      created: 1,
    });
    expect(await (await post(token, timstore())).json()).toEqual({
      ok: true,
      received: 1,
      created: 0,
    });
    const changed = await post(token, { ...timstore(), event: 'order.status_changed' });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ ok: true, ignored: true });
    expect(fake.all('autotim', 'inbox_orders')).toHaveLength(1);
  });
});
