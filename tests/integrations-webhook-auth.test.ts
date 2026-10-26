// P4 — Webhooks Shopify / WooCommerce : signature OBLIGATOIRE (fail-closed).
//
// AVANT : `if (integration.secret_key && !verify(...))` — un secret_key vide
// (valeur par défaut de POST /api/integrations) désactivait la vérification :
// n'importe qui connaissant le domaine écrivait des commandes dans le tenant.
// Secrets et boutiques SYNTHÉTIQUES.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { verifyHmacSha256Base64 } from '@/lib/security/webhook-hmac';

let db: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => db,
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SECRET_A = 'whsec-test-tenant-A';
const SECRET_B = 'whsec-test-tenant-B';
const sign = (body: string, secret: string) =>
  crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');

const PLATFORMS = {
  shopify: {
    path: '@/app/api/integrations/shopify/webhook/route',
    domainHeader: 'x-shopify-shop-domain',
    sigHeader: 'x-shopify-hmac-sha256',
    topic: { 'x-shopify-topic': 'orders/create' },
    body: JSON.stringify({
      id: 501,
      name: '#501',
      financial_status: 'paid',
      fulfillment_status: null,
      total_price: '2500',
      shipping_address: { first_name: 'Amine', last_name: 'B', phone: '0550000001', city: 'Oran' },
      line_items: [{ name: 'Montre' }],
    }),
  },
  woocommerce: {
    path: '@/app/api/integrations/woocommerce/webhook/route',
    domainHeader: 'x-wc-webhook-source',
    sigHeader: 'x-wc-webhook-signature',
    topic: { 'x-wc-webhook-topic': 'order.created' },
    body: JSON.stringify({
      id: 501,
      number: 501,
      status: 'processing',
      total: '2500',
      billing: { first_name: 'Amine', last_name: 'B', phone: '0550000001', city: 'Oran' },
      line_items: [{ name: 'Montre' }],
    }),
  },
} as const;
type Platform = keyof typeof PLATFORMS;

function seed(platform: Platform, user: string, domain: string, secret: unknown) {
  db.seed('public', 'integrations', [
    { user_id: user, platform, identifier: domain, secret_key: secret, active: true },
  ]);
}

async function post(
  platform: Platform,
  domain: string,
  signature: string | null,
  opts: { body?: string; query?: string; extraHeaders?: Record<string, string> } = {}
) {
  const p = PLATFORMS[platform];
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [p.domainHeader]: domain,
    ...p.topic,
    ...(opts.extraHeaders ?? {}),
  };
  if (signature !== null) headers[p.sigHeader] = signature;
  const { POST } = (await import(/* @vite-ignore */ p.path)) as {
    POST: (r: NextRequest) => Promise<Response>;
  };
  const res = await POST(
    new NextRequest(`https://app.test/api/integrations/${platform}/webhook${opts.query ?? ''}`, {
      method: 'POST',
      headers,
      body: opts.body ?? p.body,
    })
  );
  return res.status;
}

const orderWrites = () => db.writes.filter((w) => w.table === 'public.orders');

beforeEach(() => {
  db = new FakeSupabase();
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => vi.restoreAllMocks());

describe.each(Object.keys(PLATFORMS) as Platform[])('webhook %s', (platform) => {
  const body = PLATFORMS[platform].body;

  it('A — secret configuré + bonne signature → accepté, commande écrite pour CE tenant', async () => {
    seed(platform, A, 'a.test', SECRET_A);
    expect(await post(platform, 'a.test', sign(body, SECRET_A))).toBe(200);
    expect(orderWrites()).toHaveLength(1);
    expect(orderWrites()[0].rows[0].user_id).toBe(A);
  });

  it('B — secret configuré + mauvaise signature → 401, rien écrit', async () => {
    seed(platform, A, 'a.test', SECRET_A);
    expect(await post(platform, 'a.test', sign(body, 'autre-secret'))).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it('C — secret configuré + en-tête de signature absent → 401', async () => {
    seed(platform, A, 'a.test', SECRET_A);
    expect(await post(platform, 'a.test', null)).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it.each([
    ['vide', ''],
    ['blanc', '   '],
  ])('D — secret configuré + signature %s → 401', async (_l, sig) => {
    seed(platform, A, 'a.test', SECRET_A);
    expect(await post(platform, 'a.test', sig)).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it.each([
    ['vide ""', ''],
    ['blanc "   "', '   '],
    ['null', null],
    ['absent (undefined)', undefined],
  ])(
    'E — intégration SANS secret (%s) → FAIL-CLOSED 401, même avec une signature',
    async (_l, secret) => {
      seed(platform, A, 'a.test', secret);
      for (const sig of [null, '', 'x', sign(body, ''), sign(body, '   ')]) {
        expect(await post(platform, 'a.test', sig)).toBe(401);
      }
      expect(db.writes).toHaveLength(0);
    }
  );

  it('F/G — refus : aucune écriture ni effet de bord (le corps n’est jamais appliqué)', async () => {
    seed(platform, A, 'a.test', '');
    await post(platform, 'a.test', 'faux');
    expect(db.writes).toHaveLength(0);
  });

  it('H — signature valide pour B mais domaine de A → 401 ; B n’écrit que chez B', async () => {
    seed(platform, A, 'a.test', SECRET_A);
    seed(platform, B, 'b.test', SECRET_B);
    expect(await post(platform, 'a.test', sign(body, SECRET_B))).toBe(401);
    expect(db.writes).toHaveLength(0);
    expect(await post(platform, 'b.test', sign(body, SECRET_B))).toBe(200);
    expect(orderWrites().every((w) => w.rows.every((r) => r.user_id === B))).toBe(true);
  });

  it('contournements : signature en query, en-tête voisin ou corps modifié → refusés', async () => {
    seed(platform, A, 'a.test', SECRET_A);
    const good = sign(body, SECRET_A);
    expect(
      await post(platform, 'a.test', null, {
        query: `?hmac=${encodeURIComponent(good)}&signature=${encodeURIComponent(good)}`,
      })
    ).toBe(401);
    expect(
      await post(platform, 'a.test', null, {
        extraHeaders: { 'x-hub-signature-256': good, authorization: good },
      })
    ).toBe(401);
    expect(await post(platform, 'a.test', good, { body: body.replace('2500', '1') })).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it('endpoint voisin : signature de l’autre plateforme refusée (secret propre à l’intégration)', async () => {
    const other: Platform = platform === 'shopify' ? 'woocommerce' : 'shopify';
    seed(other, A, 'a.test', SECRET_A);
    seed(platform, A, 'a.test', 'secret-different-de-l-autre');
    expect(await post(platform, 'a.test', sign(body, SECRET_A))).toBe(401);
  });

  it('seule la méthode POST est exposée (GET/PUT/DELETE → 405 par Next)', async () => {
    const mod = (await import(/* @vite-ignore */ PLATFORMS[platform].path)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(mod).filter((k) => /^(GET|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });
});

describe('verifyHmacSha256Base64', () => {
  const body = '{"a":1}';
  it('signature correcte (espaces autour tolérés) → ok', () => {
    expect(verifyHmacSha256Base64(body, ` ${sign(body, 's')} `, 's')).toEqual({ ok: true });
  });
  it.each([
    [undefined, 'no_secret'],
    [null, 'no_secret'],
    ['', 'no_secret'],
    ['  ', 'no_secret'],
  ])('secret %p → %s', (secret, reason) => {
    expect(verifyHmacSha256Base64(body, sign(body, 'x'), secret as never)).toEqual({
      ok: false,
      reason,
    });
  });
  it('signature de longueur différente → bad_signature (pas d’exception de timingSafeEqual)', () => {
    expect(verifyHmacSha256Base64(body, 'abc', 's')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
  it('le secret n’est pas rogné comme clé : « s » et « s  » donnent des signatures différentes', () => {
    expect(verifyHmacSha256Base64(body, sign(body, 's'), 's  ')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
});
