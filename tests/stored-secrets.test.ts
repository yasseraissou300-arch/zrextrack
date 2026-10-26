// SECRETS-REST — secret HMAC Shopify / WooCommerce et Auth Token Twilio
// chiffrés au repos (secret-box), déchiffrés uniquement côté serveur.
// Secrets SYNTHÉTIQUES ; trousseau généré à l'exécution.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { isSealed } from '@/lib/security/secret-box';
import {
  openIntegrationSecret,
  sealIntegrationSecret,
  openTwilioToken,
  sealTwilioToken,
} from '@/lib/security/stored-secrets';

let db: FakeSupabase;
let sessionUser: { id: string } | null;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SHOP_SECRET = 'whsec-shop-secret-TEST-0123456789';
const TWILIO_TOKEN = 'twilio-auth-token-TEST-abcdef0123';
const DOMAIN = 'boutique-a.myshopify.com';
const BODY = JSON.stringify({
  id: 501,
  name: '#501',
  financial_status: 'paid',
  fulfillment_status: null,
  total_price: '2500',
  shipping_address: { first_name: 'Amine', last_name: 'B', phone: '0550000001', city: 'Oran' },
  line_items: [{ name: 'Montre' }],
});
const sign = (body: string, secret: string) =>
  crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');

function consoleText(): string {
  return (['log', 'info', 'warn', 'error'] as const)
    .flatMap((m) => (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls)
    .map((c) => c.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    .join(' | ');
}

beforeEach(() => {
  db = new FakeSupabase();
  sessionUser = { id: A };
  vi.stubEnv('SECRETS_KEYRING', `k1:${crypto.randomBytes(32).toString('base64')}`);
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── Shopify / WooCommerce ──────────────────────────────────────────────────
async function shopifyWebhook(signature: string) {
  const { POST } = await import('@/app/api/integrations/shopify/webhook/route');
  const res = await POST(
    new NextRequest('https://app.test/api/integrations/shopify/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-shop-domain': DOMAIN,
        'x-shopify-topic': 'orders/create',
        'x-shopify-hmac-sha256': signature,
      },
      body: BODY,
    })
  );
  return { status: res.status, text: await res.text() };
}

function seedIntegration(secret: string, user = A) {
  db.seed('public', 'integrations', [
    { user_id: user, platform: 'shopify', identifier: DOMAIN, secret_key: secret, active: true },
  ]);
}
const orderWrites = () => db.writes.filter((w) => w.table === 'public.orders');

describe('integrations.secret_key — stockage', () => {
  it('POST /api/integrations chiffre le secret ; la réponse ne le contient jamais', async () => {
    const { POST } = await import('@/app/api/integrations/route');
    const res = await POST(
      new NextRequest('https://app.test/api/integrations', {
        method: 'POST',
        body: JSON.stringify({ platform: 'shopify', identifier: DOMAIN, secret_key: SHOP_SECRET }),
      })
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(SHOP_SECRET);
    const stored = db.all('public', 'integrations')[0].secret_key as string;
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain(SHOP_SECRET);
    expect(text).not.toContain(stored);
    expect(JSON.parse(text).integration?.secret_configured ?? true).toBe(true);
  });
});

describe('integrations.secret_key — webhook Shopify', () => {
  it('secret chiffré + bonne signature → commande écrite', async () => {
    seedIntegration(sealIntegrationSecret(A, 'shopify', SHOP_SECRET));
    expect((await shopifyWebhook(sign(BODY, SHOP_SECRET))).status).toBe(200);
    expect(orderWrites().length).toBeGreaterThan(0);
  });

  it('secret historique en clair → toujours accepté (migration progressive)', async () => {
    seedIntegration(SHOP_SECRET);
    expect((await shopifyWebhook(sign(BODY, SHOP_SECRET))).status).toBe(200);
  });

  it('signée avec le CHIFFRÉ (valeur stockée) au lieu du secret → refus', async () => {
    const stored = sealIntegrationSecret(A, 'shopify', SHOP_SECRET);
    seedIntegration(stored);
    expect((await shopifyWebhook(sign(BODY, stored))).status).toBe(401);
    expect(orderWrites()).toHaveLength(0);
  });

  it('secret chiffré d’un AUTRE tenant recopié → illisible (AAD) → refus, aucune écriture', async () => {
    seedIntegration(sealIntegrationSecret(B, 'shopify', SHOP_SECRET));
    expect((await shopifyWebhook(sign(BODY, SHOP_SECRET))).status).toBe(401);
    expect(orderWrites()).toHaveLength(0);
  });

  it('chiffré corrompu → refus, aucune écriture, aucun secret dans les logs ni la réponse', async () => {
    const sealed = sealIntegrationSecret(A, 'shopify', SHOP_SECRET);
    seedIntegration(sealed.slice(0, -4) + 'AAAA');
    const r = await shopifyWebhook(sign(BODY, SHOP_SECRET));
    expect(r.status).toBe(401);
    expect(orderWrites()).toHaveLength(0);
    expect(r.text + consoleText()).not.toContain(SHOP_SECRET);
  });

  it('open côté serveur : le plateforme fait partie du contexte (shopify ≠ woocommerce)', () => {
    const sealed = sealIntegrationSecret(A, 'shopify', SHOP_SECRET);
    expect(openIntegrationSecret(A, 'shopify', sealed)).toBe(SHOP_SECRET);
    expect(openIntegrationSecret(A, 'woocommerce', sealed)).toBeNull();
  });
});

// ─── Twilio ─────────────────────────────────────────────────────────────────
describe('voice_call_settings.auth_token', () => {
  async function postSettings(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/voice-calls/settings/route');
    return POST(
      new NextRequest('https://app.test/api/voice-calls/settings', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    );
  }
  async function getSettingsRoute() {
    const { GET } = await import('@/app/api/voice-calls/settings/route');
    return (await GET()).text();
  }

  it('POST chiffre l’Auth Token ; GET ne renvoie que 4 caractères du CLAIR', async () => {
    await postSettings({ account_sid: 'AC123', auth_token: TWILIO_TOKEN });
    const stored = db.all('public', 'voice_call_settings')[0].auth_token as string;
    expect(isSealed(stored)).toBe(true);
    const text = await getSettingsRoute();
    expect(text).not.toContain(TWILIO_TOKEN);
    expect(text).not.toContain(stored);
    expect(JSON.parse(text).settings.auth_token).toBe(`••••${TWILIO_TOKEN.slice(-4)}`);
  });

  it('renvoyer la valeur masquée n’écrase pas le jeton stocké', async () => {
    await postSettings({ auth_token: TWILIO_TOKEN });
    const before = db.all('public', 'voice_call_settings')[0].auth_token;
    await postSettings({ auth_token: `••••${TWILIO_TOKEN.slice(-4)}`, shop_name: 'X' });
    expect(db.all('public', 'voice_call_settings')[0].auth_token).toBe(before);
  });

  it('getSettings (serveur) déchiffre ; jeton d’un autre tenant ou corrompu → null', async () => {
    const { getSettings } = await import('@/lib/voice-calls/twilio');
    db.seed('public', 'voice_call_settings', [
      { user_id: A, auth_token: sealTwilioToken(A, TWILIO_TOKEN), account_sid: 'AC1' },
      { user_id: B, auth_token: sealTwilioToken(A, TWILIO_TOKEN), account_sid: 'AC2' },
    ]);
    expect((await getSettings(A))?.auth_token).toBe(TWILIO_TOKEN);
    expect((await getSettings(B))?.auth_token).toBeNull();
    expect(openTwilioToken(A, 'enc:v1:k1:AAAA:BBBB')).toBeNull();
  });

  it('erreur d’enregistrement → message générique', async () => {
    db.failNext('public', 'voice_call_settings', 'upsert', { message: `boom ${TWILIO_TOKEN}` });
    const res = await postSettings({ auth_token: TWILIO_TOKEN });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(TWILIO_TOKEN);
  });
});

describe('garde de signature Twilio avec jeton chiffré', () => {
  const CID = 'call-1';
  const URL_ = `https://app.test/api/voice-calls/status?cid=${CID}`;
  const params = { CallSid: 'CA1', CallStatus: 'completed' };

  async function guard(signature: string | null) {
    const { guardTwilioRequest } = await import('@/lib/security/twilio-guard');
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    if (signature) headers['x-twilio-signature'] = signature;
    return guardTwilioRequest(
      new NextRequest(URL_, {
        method: 'POST',
        headers,
        body: new URLSearchParams(params).toString(),
      }),
      'test.twilio'
    );
  }

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.test');
    db.seed('public', 'voice_calls', [{ id: CID, user_id: A }]);
  });

  it('jeton chiffré + bonne signature → accepté (vérifié)', async () => {
    db.seed('public', 'voice_call_settings', [
      { user_id: A, auth_token: sealTwilioToken(A, TWILIO_TOKEN) },
    ]);
    const { computeTwilioSignature } = await import('@/lib/security/twilio-signature');
    const r = await guard(computeTwilioSignature(TWILIO_TOKEN, URL_, params));
    expect(r).toMatchObject({ ok: true, mode: 'verified' });
  });

  it('jeton chiffré + mauvaise signature → refus', async () => {
    db.seed('public', 'voice_call_settings', [
      { user_id: A, auth_token: sealTwilioToken(A, TWILIO_TOKEN) },
    ]);
    expect((await guard('bad-signature')).ok).toBe(false);
  });

  it('jeton STOCKÉ mais illisible → refus (jamais « non appliqué »), même sans signature', async () => {
    db.seed('public', 'voice_call_settings', [
      { user_id: A, auth_token: sealTwilioToken(B, TWILIO_TOKEN) },
    ]);
    const r = await guard(null);
    expect(r).toMatchObject({ ok: false, status: 401, reason: 'auth_token_unreadable' });
  });
});
