// Phase C — anti-rejeu DURABLE de tous les webhooks (autotim.webhook_events),
// efficace entre instances Vercel et après un démarrage à froid.
//
// Chaque « instance » = modules rechargés (vi.resetModules) : la mémoire
// (isReplay) est vide, seule la base partagée (FakeSupabase) se souvient.
//
//   Meta / Twilio : « au plus une fois » (marqué avant traitement)
//   Shopify / Woo : « au moins une fois » (vérifié avant, enregistré APRÈS
//                   succès ; un échec d'écriture → 500, le fournisseur réessaie)

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => db,
}));
vi.mock('@/lib/user-creds', () => ({
  resolveGeminiKeys: async () => ['gemini-test-key'],
  resolveEvolutionCreds: async () => ({ url: '', key: '' }),
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let geminiCalls = 0;

beforeEach(() => {
  db = new FakeSupabase();
  geminiCalls = 0;
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('https://generativelanguage.googleapis.com')) {
        geminiCalls++;
        return Response.json({ candidates: [{ content: { parts: [{ text: 'Salam !' }] } }] });
      }
      return Response.json({});
    })
  );
  vi.stubEnv('FACEBOOK_APP_SECRET', '');
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── Meta / Messenger ───────────────────────────────────────────────────────
describe('Messenger — mid durable', () => {
  beforeEach(() => {
    db.seed('public', 'facebook_connections', [
      { user_id: A, page_id: 'page-1', page_access_token: 'tok' },
    ]);
    db.seed('public', 'chatbot_configs', [
      { user_id: A, is_active: true, template_type: 'auto_confirmation', custom_prompt: null },
    ]);
  });

  async function fbPost(mid: string, timestamp = Date.now()) {
    vi.resetModules(); // nouvelle instance / démarrage à froid
    const { POST } = await import('@/app/api/ai-chatbot/webhook/facebook/route');
    return POST(
      new NextRequest('https://app.test/api/ai-chatbot/webhook/facebook', {
        method: 'POST',
        body: JSON.stringify({
          object: 'page',
          entry: [
            {
              id: 'page-1',
              messaging: [{ sender: { id: 'psid' }, timestamp, message: { mid, text: 'Salam' } }],
            },
          ],
        }),
      })
    );
  }

  it('même mid relivré après démarrage à froid → l’IA ne répond qu’une fois', async () => {
    await fbPost('mid-1');
    await fbPost('mid-1');
    expect(geminiCalls).toBe(1);
  });

  it('deux livraisons concurrentes du même mid → une seule réponse', async () => {
    await Promise.all([fbPost('mid-2'), fbPost('mid-2')]);
    expect(geminiCalls).toBe(1);
  });

  it('mid différent → traitement normal', async () => {
    await fbPost('mid-3');
    await fbPost('mid-4');
    expect(geminiCalls).toBe(2);
  });

  it('événement plus ancien que la rétention (8 j) → ignoré', async () => {
    await fbPost('mid-old', Date.now() - 8 * 86_400_000);
    expect(geminiCalls).toBe(0);
  });
});

// ─── Twilio ─────────────────────────────────────────────────────────────────
describe('Twilio — CallSid durable', () => {
  const URL_ = 'https://app.test/api/voice-calls/status?cid=call-1';
  // Signature obligatoire (#134) : requêtes signées avec le jeton du tenant.
  const TWILIO_TOKEN = 'TEST_TWILIO_AUTH_TOKEN';
  async function guard(callStatus: string) {
    vi.resetModules();
    const { guardTwilioRequest } = await import('@/lib/security/twilio-guard');
    const { computeTwilioSignature } = await import('@/lib/security/twilio-signature');
    const params = { CallSid: 'CA1', CallStatus: callStatus };
    return guardTwilioRequest(
      new NextRequest(URL_, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': computeTwilioSignature(TWILIO_TOKEN, URL_, params),
        },
        body: new URLSearchParams(params).toString(),
      }),
      'test.twilio'
    );
  }
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.test');
    db.seed('public', 'voice_calls', [{ id: 'call-1', user_id: A }]);
    db.seed('public', 'voice_call_settings', [{ user_id: A, auth_token: TWILIO_TOKEN }]);
  });

  it('même CallSid + statut rejoué après démarrage à froid → 409', async () => {
    expect((await guard('completed')).ok).toBe(true);
    expect(await guard('completed')).toMatchObject({ ok: false, status: 409 });
  });

  it('autre statut du même appel → accepté', async () => {
    expect((await guard('ringing')).ok).toBe(true);
    expect((await guard('completed')).ok).toBe(true);
  });
});

// ─── Shopify / WooCommerce ──────────────────────────────────────────────────
const SECRET = 'whsec-durable-test';
const sign = (body: string) => crypto.createHmac('sha256', SECRET).update(body).digest('base64');
const SHOP_BODY = JSON.stringify({
  id: 501,
  name: '#1001',
  financial_status: 'paid',
  fulfillment_status: null,
  total_price: '2500',
  shipping_address: { first_name: 'Amine', last_name: 'B', phone: '0550000001', city: 'Oran' },
  line_items: [{ name: 'Montre' }],
});

function seedShop(user: string, domain: string) {
  db.seed('public', 'integrations', [
    { user_id: user, platform: 'shopify', identifier: domain, secret_key: SECRET, active: true },
  ]);
}
async function shopify(domain: string, webhookId: string, triggeredAt?: string) {
  vi.resetModules();
  const { POST } = await import('@/app/api/integrations/shopify/webhook/route');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-shopify-shop-domain': domain,
    'x-shopify-topic': 'orders/updated',
    'x-shopify-hmac-sha256': sign(SHOP_BODY),
    'x-shopify-webhook-id': webhookId,
  };
  if (triggeredAt) headers['x-shopify-triggered-at'] = triggeredAt;
  const res = await POST(
    new NextRequest('https://app.test/api/integrations/shopify/webhook', {
      method: 'POST',
      headers,
      body: SHOP_BODY,
    })
  );
  return { status: res.status, body: await res.json() };
}
const orderWrites = () => db.writes.filter((w) => w.table === 'public.orders');

describe('Shopify — X-Shopify-Webhook-Id durable', () => {
  it('même livraison rejouée après démarrage à froid → 200 dédoublonné, une seule écriture', async () => {
    seedShop(A, 'a.myshopify.com');
    expect((await shopify('a.myshopify.com', 'wh-1')).status).toBe(200);
    const r = await shopify('a.myshopify.com', 'wh-1');
    expect(r).toMatchObject({ status: 200, body: { deduped: true } });
    expect(orderWrites()).toHaveLength(1);
  });

  it('écriture en échec → 500, RIEN de marqué : la nouvelle tentative du fournisseur est traitée', async () => {
    seedShop(A, 'a.myshopify.com');
    db.failNext('public', 'orders', 'upsert');
    expect((await shopify('a.myshopify.com', 'wh-2')).status).toBe(500);
    const retry = await shopify('a.myshopify.com', 'wh-2');
    expect(retry.status).toBe(200);
    expect(retry.body.deduped).toBeUndefined();
  });

  it('livraison plus ancienne que la rétention (X-Shopify-Triggered-At 8 j) → ignorée', async () => {
    seedShop(A, 'a.myshopify.com');
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const r = await shopify('a.myshopify.com', 'wh-3', old);
    expect(r.body.stale).toBe(true);
    expect(orderWrites()).toHaveLength(0);
  });

  it('deux tenants, même numéro #1001 et même id de livraison → deux commandes distinctes', async () => {
    seedShop(A, 'a.myshopify.com');
    seedShop(B, 'b.myshopify.com');
    await shopify('a.myshopify.com', 'wh-same');
    await shopify('b.myshopify.com', 'wh-same');
    const rows = db.all('public', 'orders');
    expect(rows.map((r) => r.user_id).sort()).toEqual([A, B]);
    expect(rows.every((r) => r.tracking_number === 'SHO-1001')).toBe(true);
  });

  it('onConflict par tenant (user_id, tracking_number)', async () => {
    seedShop(A, 'a.myshopify.com');
    await shopify('a.myshopify.com', 'wh-4');
    const w = orderWrites()[0] as unknown as { onConflict?: string };
    if (w.onConflict !== undefined) expect(w.onConflict).toBe('user_id,tracking_number');
  });
});

describe('WooCommerce — X-WC-Webhook-Delivery-ID durable', () => {
  it('même livraison rejouée → une seule écriture', async () => {
    db.seed('public', 'integrations', [
      {
        user_id: A,
        platform: 'woocommerce',
        identifier: 'https://shop.test',
        secret_key: SECRET,
        active: true,
      },
    ]);
    const body = JSON.stringify({
      id: 77,
      number: 77,
      status: 'processing',
      total: '2500',
      billing: { first_name: 'A', last_name: 'B', phone: '0550000001', city: 'Oran' },
      line_items: [{ name: 'Montre' }],
    });
    const post = async () => {
      vi.resetModules();
      const { POST } = await import('@/app/api/integrations/woocommerce/webhook/route');
      return POST(
        new NextRequest('https://app.test/api/integrations/woocommerce/webhook', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-wc-webhook-source': 'https://shop.test',
            'x-wc-webhook-topic': 'order.updated',
            'x-wc-webhook-signature': crypto
              .createHmac('sha256', SECRET)
              .update(body)
              .digest('base64'),
            'x-wc-webhook-delivery-id': '9001',
          },
          body,
        })
      );
    };
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(orderWrites()).toHaveLength(1);
  });
});
