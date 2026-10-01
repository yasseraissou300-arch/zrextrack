// P4 — Webhooks Shopify / WooCommerce : `upsert(..., { onConflict: 'tracking_number' })`
// confronté aux DEUX schémas possibles de public.orders. AUDIT : aucun code
// modifié ; ces tests constatent le comportement ACTUEL (main 9c2b249).
//
// Le client simulé applique la règle PostgreSQL d'ON CONFLICT :
//   - la cible doit correspondre EXACTEMENT à une contrainte / un index unique,
//     sinon erreur 42P10 « there is no unique or exclusion constraint matching
//     the ON CONFLICT specification » ;
//   - sinon : conflit sur la cible → mise à jour de TOUTES les colonnes fournies
//     (user_id compris) ; violation d'une AUTRE contrainte unique → 23505.
// supabase-js ne lève pas : il renvoie { error }.
//
// Modèle A = (user_id, tracking_number) UNIQUE — mesuré le 2026-09-10/11
//            (en-tête de db/proposed/003_public_indexes.sql) ;
// Modèle B = tracking_number UNIQUE global — schéma d'origine du dépôt.
// Données entièrement synthétiques.
//
// ⚠️ Tests de CONSTAT : ils décrivent le comportement défectueux actuel. Lors de
// la correction (après vérification du schéma réel, HUMAN-ONCONFLICT-001),
// inverser les attentes « 200 malgré l'erreur », « rien écrit » et « écrasé ».

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Mode = 'normal' | 'error' | 'throw' | 'null';

const state: {
  uniques: string[][];
  orders: Row[];
  integrations: Row[];
  mode: Mode;
  upsertResults: Array<{ error: { code: string } | null }>;
} = { uniques: [], orders: [], integrations: [], mode: 'normal', upsertResults: [] };

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((c) => b.includes(c));

function upsertOrders(row: Row, onConflict: string) {
  if (state.mode === 'throw') throw new Error('connexion perdue (simulée)');
  if (state.mode === 'error')
    return { data: null, error: { code: '08006', message: 'connection failure' } };
  if (state.mode === 'null') return { data: null, error: null }; // aucune ligne, aucune erreur
  const target = onConflict.split(',').map((s) => s.trim());
  if (!state.uniques.some((u) => sameSet(u, target))) {
    return {
      data: null,
      error: {
        code: '42P10',
        message:
          'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      },
    };
  }
  const existing = state.orders.find((o) => target.every((c) => o[c] === row[c]));
  // id : DEFAULT gen_random_uuid() en base.
  const candidate: Row = existing ? { ...existing, ...row } : { id: crypto.randomUUID(), ...row };
  for (const u of state.uniques) {
    // NULL ne viole jamais une contrainte d'unicité.
    const clash = state.orders.find(
      (o) => o !== existing && u.every((c) => candidate[c] != null && o[c] === candidate[c])
    );
    if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
  }
  if (existing) Object.assign(existing, row);
  else state.orders.push(candidate);
  return { data: null, error: null };
}

function integrationsQuery() {
  const filters: Array<[string, unknown]> = [];
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      filters.push([c, v]);
      return q;
    },
    single: async () => {
      const hit = state.integrations.find((r) => filters.every(([c, v]) => r[c] === v));
      return { data: hit ?? null, error: hit ? null : { code: 'PGRST116' } };
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (t: string) =>
      t === 'integrations'
        ? integrationsQuery()
        : {
            upsert: async (row: Row, opts: { onConflict: string }) => {
              const r = upsertOrders(row, opts.onConflict);
              state.upsertResults.push({ error: r.error });
              return r;
            },
          },
  }),
}));

const MODEL_A = [['id'], ['user_id', 'tracking_number']];
const MODEL_B = [['id'], ['tracking_number']];
const TA = '11111111-1111-4111-8111-111111111111';
const TB = '22222222-2222-4222-8222-222222222222';

const P = {
  shopify: {
    path: '@/app/api/integrations/shopify/webhook/route',
    headers: (domain: string, sig: string) => ({
      'x-shopify-shop-domain': domain,
      'x-shopify-topic': 'orders/create',
      'x-shopify-hmac-sha256': sig,
    }),
    body: (n: number, product: string) =>
      JSON.stringify({
        id: n,
        name: `#${n}`,
        financial_status: 'paid',
        fulfillment_status: null,
        total_price: '1000',
        shipping_address: {
          first_name: 'Client',
          last_name: product,
          phone: '0550000001',
          city: 'Oran',
        },
        line_items: [{ name: product }],
      }),
    tracking: (n: number) => `SHO-${n}`,
  },
  woocommerce: {
    path: '@/app/api/integrations/woocommerce/webhook/route',
    headers: (domain: string, sig: string) => ({
      'x-wc-webhook-source': domain,
      'x-wc-webhook-topic': 'order.created',
      'x-wc-webhook-signature': sig,
    }),
    body: (n: number, product: string) =>
      JSON.stringify({
        id: n,
        number: n,
        status: 'processing',
        total: '1000',
        billing: { first_name: 'Client', last_name: product, phone: '0550000001', city: 'Oran' },
        line_items: [{ name: product }],
      }),
    tracking: (n: number) => `WOO-${n}`,
  },
} as const;
type Platform = keyof typeof P;
const SECRET = { [TA]: 'whsec-A', [TB]: 'whsec-B' } as Record<string, string>;
const DOMAIN = { [TA]: 'a.test', [TB]: 'b.test' } as Record<string, string>;

async function deliver(platform: Platform, tenant: string, n: number, product: string) {
  const p = P[platform];
  const body = p.body(n, product);
  const sig = crypto.createHmac('sha256', SECRET[tenant]).update(body, 'utf8').digest('base64');
  const { POST } = (await import(/* @vite-ignore */ p.path)) as {
    POST: (r: NextRequest) => Promise<Response>;
  };
  const res = await POST(
    new NextRequest(`https://app.test/api/integrations/${platform}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...p.headers(DOMAIN[tenant], sig) },
      body,
    })
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  state.orders = [];
  state.mode = 'normal';
  state.upsertResults = [];
  state.integrations = (['shopify', 'woocommerce'] as const).flatMap((platform) =>
    [TA, TB].map((t) => ({
      user_id: t,
      platform,
      identifier: DOMAIN[t],
      secret_key: SECRET[t],
      active: true,
    }))
  );
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => vi.restoreAllMocks());

describe.each(Object.keys(P) as Platform[])('%s — comportement ACTUEL', (platform) => {
  describe('Modèle A — UNIQUE (user_id, tracking_number) [schéma mesuré 2026-09-10/11]', () => {
    beforeEach(() => (state.uniques = MODEL_A));

    it('nouvelle commande : 42P10 (cible sans contrainte) → RIEN écrit, mais 200 { ok: true }', async () => {
      const r = await deliver(platform, TA, 1001, 'Montre');
      expect(state.upsertResults[0].error?.code).toBe('42P10');
      expect(state.orders).toHaveLength(0); // commande PERDUE
      expect(r).toEqual({ status: 200, json: { ok: true } }); // la boutique croit que c'est livré
    });

    it('même tenant, même numéro (mise à jour) : idem, 42P10, rien écrit', async () => {
      await deliver(platform, TA, 1001, 'Montre');
      await deliver(platform, TA, 1001, 'Montre');
      expect(state.upsertResults.every((u) => u.error?.code === '42P10')).toBe(true);
      expect(state.orders).toHaveLength(0);
    });

    it('tenants différents, même numéro : aucun écrasement… parce que rien n’est jamais écrit', async () => {
      await deliver(platform, TA, 1001, 'Montre');
      await deliver(platform, TB, 1001, 'Sac');
      expect(state.orders).toHaveLength(0);
    });
  });

  describe('Modèle B — UNIQUE (tracking_number) global [schéma d’origine]', () => {
    beforeEach(() => (state.uniques = MODEL_B));

    it('même tenant, numéro différent : deux commandes créées', async () => {
      await deliver(platform, TA, 1001, 'Montre');
      await deliver(platform, TA, 1002, 'Sac');
      expect(state.orders.map((o) => o.tracking_number)).toEqual([
        P[platform].tracking(1001),
        P[platform].tracking(1002),
      ]);
    });

    it('même tenant, même numéro : mise à jour de la même ligne (attendu)', async () => {
      await deliver(platform, TA, 1001, 'Montre');
      await deliver(platform, TA, 1001, 'Montre v2');
      expect(state.orders).toHaveLength(1);
      expect(state.orders[0].product_name).toBe('Montre v2');
    });

    it('tenants différents, même numéro : la commande de A est ÉCRASÉE et passe chez B', async () => {
      await deliver(platform, TA, 1001, 'Montre');
      await deliver(platform, TB, 1001, 'Sac');
      expect(state.orders).toHaveLength(1);
      expect(state.orders[0]).toMatchObject({ user_id: TB, product_name: 'Sac' });
    });
  });

  describe('gestion d’erreur (indépendante du schéma)', () => {
    beforeEach(() => (state.uniques = MODEL_A));

    it('upsert en erreur → 200 { ok: true }, erreur ni vérifiée ni journalisée', async () => {
      state.mode = 'error';
      const errors: unknown[] = [];
      vi.mocked(console.error).mockImplementation((...a: unknown[]) => {
        errors.push(a);
      });
      const r = await deliver(platform, TA, 1001, 'Montre');
      expect(r).toEqual({ status: 200, json: { ok: true } });
      expect(errors).toHaveLength(0);
    });

    it('exception base → avalée par le catch, 200 { ok: true }', async () => {
      state.mode = 'throw';
      expect(await deliver(platform, TA, 1001, 'Montre')).toEqual({
        status: 200,
        json: { ok: true },
      });
    });

    it('résultat nul sans erreur → 200 (aucune vérification du résultat)', async () => {
      state.mode = 'null';
      expect((await deliver(platform, TA, 1001, 'Montre')).status).toBe(200);
      expect(state.orders).toHaveLength(0);
    });
  });

  it('cible compatible (contrôle) : avec onConflict « user_id,tracking_number », le modèle A fonctionnerait', () => {
    state.uniques = MODEL_A;
    expect(
      upsertOrders({ user_id: TA, tracking_number: 'X-1' }, 'user_id,tracking_number').error
    ).toBeNull();
    expect(
      upsertOrders({ user_id: TB, tracking_number: 'X-1' }, 'user_id,tracking_number').error
    ).toBeNull();
    expect(state.orders).toHaveLength(2); // pas de collision entre tenants
  });
});
