// P4 — Spécification CIBLE des webhooks Shopify / WooCommerce (erreurs + tenant).
//
// Ce fichier décrit le comportement ATTENDU après la correction « erreurs
// avalées + onConflict » (en attente de HUMAN-ONCONFLICT-001). Les cas pas
// encore implémentés sont marqués `pending` → exécutés avec it.fails : la suite
// reste verte, et devient ROUGE dès que la correction les rend vrais — retirer
// alors l'identifiant de PENDING. Aucun code de production modifié.
//
// Client simulé fidèle à la règle PostgreSQL d'ON CONFLICT (voir
// tests/webhook-onconflict.test.ts, branche p4-webhook-onconflict-audit) :
// cible = contrainte unique EXACTE sinon 42P10 ; NULL ne viole rien.
// Modèle A = UNIQUE(user_id, tracking_number) — hypothèse (snapshot du
// 2026-09-11, NON prouvé en production). Modèle B = UNIQUE(tracking_number).
// Données entièrement synthétiques.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const state = {
  uniques: [] as string[][],
  orders: [] as Row[],
  integrations: [] as Row[],
  fault: null as null | 'error' | 'throw',
};

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((c) => b.includes(c));

function upsert(row: Row, onConflict: string) {
  if (state.fault === 'throw') throw new Error('socket hang up (simulé)');
  if (state.fault === 'error') {
    return {
      data: null,
      error: { code: '08006', message: 'connection failure on relation "orders"' },
    };
  }
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
  const candidate: Row = existing ? { ...existing, ...row } : { id: crypto.randomUUID(), ...row };
  for (const u of state.uniques) {
    const clash = state.orders.find(
      (o) => o !== existing && u.every((c) => candidate[c] != null && o[c] === candidate[c])
    );
    if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
  }
  if (existing) Object.assign(existing, row);
  else state.orders.push(candidate);
  return { data: null, error: null };
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (t: string) => {
      if (t === 'orders')
        return { upsert: async (row: Row, o: { onConflict: string }) => upsert(row, o.onConflict) };
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        single: async () => {
          const hit = state.integrations.find((r) => filters.every(([c, v]) => r[c] === v));
          return { data: hit ?? null, error: hit ? null : { code: 'PGRST116' } };
        },
      };
      return q;
    },
  }),
}));

const TA = '11111111-1111-4111-8111-111111111111';
const TB = '22222222-2222-4222-8222-222222222222';
const SECRET: Record<string, string> = { [TA]: 'whsec-A', [TB]: 'whsec-B' };
const DOMAIN: Record<string, string> = { [TA]: 'a.test', [TB]: 'b.test' };
const INTERNAL =
  /42P10|08006|ON CONFLICT|relation|orders|tracking_number|user_id|constraint|stack|whsec|socket/i;

const P = {
  shopify: {
    path: '@/app/api/integrations/shopify/webhook/route',
    head: (d: string, sig: string | null) => ({
      'x-shopify-shop-domain': d,
      'x-shopify-topic': 'orders/create',
      ...(sig === null ? {} : { 'x-shopify-hmac-sha256': sig }),
    }),
    body: (n: number) =>
      JSON.stringify({
        id: n,
        name: `#${n}`,
        financial_status: 'paid',
        fulfillment_status: null,
        total_price: '900',
        line_items: [{ name: 'Montre' }],
      }),
  },
  woocommerce: {
    path: '@/app/api/integrations/woocommerce/webhook/route',
    head: (d: string, sig: string | null) => ({
      'x-wc-webhook-source': d,
      'x-wc-webhook-topic': 'order.created',
      ...(sig === null ? {} : { 'x-wc-webhook-signature': sig }),
    }),
    body: (n: number) =>
      JSON.stringify({
        id: n,
        number: n,
        status: 'processing',
        total: '900',
        line_items: [{ name: 'Montre' }],
      }),
  },
} as const;
type Platform = keyof typeof P;
const sign = (b: string, s: string) =>
  crypto.createHmac('sha256', s).update(b, 'utf8').digest('base64');

async function send(
  pf: Platform,
  tenant: string,
  body: string,
  sig: string | null = sign(body, SECRET[tenant])
) {
  const { POST } = (await import(/* @vite-ignore */ P[pf].path)) as {
    POST: (r: NextRequest) => Promise<Response>;
  };
  const res = await POST(
    new NextRequest(`https://app.test/api/integrations/${pf}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...P[pf].head(DOMAIN[tenant], sig) },
      body,
    })
  );
  return { status: res.status, text: await res.text() };
}

/**
 * Cas de la spécification CIBLE non encore implémentés (main + b90f515).
 * Retirer un identifiant dès que la correction le rend vrai.
 */
const PENDING = new Set([
  '3-json-invalide-400',
  '4-succes-ecrit-A',
  '5-erreur-db-5xx',
  '6-exception-5xx',
  '7-error-5xx',
  '9-idempotent-A',
  '10-cross-tenant-A',
  '10b-cross-tenant-B-jamais-ecrase',
  '11-jamais-200-sans-ecriture-A',
]);
const spec = (id: string) => (PENDING.has(id) ? it.fails : it);

beforeEach(() => {
  state.orders = [];
  state.fault = null;
  state.uniques = [['id'], ['user_id', 'tracking_number']]; // modèle A par défaut
  state.integrations = (['shopify', 'woocommerce'] as const).flatMap((platform) =>
    [TA, TB].map((t) => ({
      user_id: t,
      platform,
      identifier: DOMAIN[t],
      secret_key: SECRET[t],
      active: true,
    }))
  );
  for (const m of ['log', 'info', 'warn', 'error'] as const)
    vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each(Object.keys(P) as Platform[])('%s — spécification cible', (pf) => {
  const body = P[pf].body(1001);

  // ── Authentification (déjà vraie avec b90f515) ──────────────────────────────
  spec('1-hmac-invalide-401')('1 — HMAC invalide → 401, rien écrit', async () => {
    const r = await send(pf, TA, body, sign(body, 'mauvais'));
    expect(r.status).toBe(401);
    expect(state.orders).toHaveLength(0);
  });

  spec('2-secret-vide-401')('2 — intégration sans secret → 401', async () => {
    state.integrations.forEach((i) => (i.secret_key = ''));
    expect((await send(pf, TA, body, sign(body, ''))).status).toBe(401);
  });

  // ── Validation ──────────────────────────────────────────────────────────────
  spec('3-json-invalide-400')(
    '3 — corps signé mais JSON invalide → 400 (pas de relivraison inutile)',
    async () => {
      const bad = '{not json';
      expect((await send(pf, TA, bad)).status).toBe(400);
    }
  );

  // ── Succès ──────────────────────────────────────────────────────────────────
  spec('4-succes-ecrit-A')(
    '4 — payload valide (modèle A) → 200 ET commande écrite pour ce tenant',
    async () => {
      const r = await send(pf, TA, body);
      expect(r.status).toBe(200);
      expect(state.orders).toHaveLength(1);
      expect(state.orders[0].user_id).toBe(TA);
    }
  );

  // ── Erreurs base / internes ─────────────────────────────────────────────────
  spec('5-erreur-db-5xx')(
    '5 — erreur base transitoire → 5xx (le fournisseur relivre)',
    async () => {
      state.fault = 'error';
      expect((await send(pf, TA, body)).status).toBeGreaterThanOrEqual(500);
    }
  );

  spec('6-exception-5xx')('6 — exception base → 5xx', async () => {
    state.fault = 'throw';
    expect((await send(pf, TA, body)).status).toBeGreaterThanOrEqual(500);
  });

  spec('7-error-5xx')(
    '7 — résultat Supabase avec error (42P10, schéma incompatible) → 5xx',
    async () => {
      state.uniques = [['id']]; // aucune contrainte correspondante
      expect((await send(pf, TA, body)).status).toBeGreaterThanOrEqual(500);
    }
  );

  spec('8-aucune-donnee-interne')(
    '8 — aucune donnée interne dans la réponse, quel que soit l’échec',
    async () => {
      for (const setup of [
        () => (state.fault = 'error'),
        () => (state.fault = 'throw'),
        () => ((state.fault = null), (state.uniques = [['id']])),
      ]) {
        setup();
        expect((await send(pf, TA, body)).text).not.toMatch(INTERNAL);
      }
    }
  );

  // ── Tenant ──────────────────────────────────────────────────────────────────
  spec('9-idempotent-A')(
    '9 — même numéro, même tenant (modèle A) → une seule ligne, mise à jour',
    async () => {
      await send(pf, TA, body);
      await send(pf, TA, body);
      expect(state.orders).toHaveLength(1);
    }
  );

  spec('10-cross-tenant-A')(
    '10 — même numéro chez deux tenants (modèle A) → deux lignes, aucune collision',
    async () => {
      await send(pf, TA, body);
      await send(pf, TB, body);
      expect(state.orders.map((o) => o.user_id).sort()).toEqual([TA, TB].sort());
    }
  );

  spec('10b-cross-tenant-B-jamais-ecrase')(
    '10b — modèle B : la commande de A n’est JAMAIS réattribuée à B',
    async () => {
      state.uniques = [['id'], ['tracking_number']];
      await send(pf, TA, body);
      const before = state.orders.find((o) => o.user_id === TA);
      await send(pf, TB, body);
      // Cible : soit B est refusé (5xx), soit A reste intact. Jamais A → B.
      if (before)
        expect(state.orders.some((o) => o.id === before.id && o.user_id === TB)).toBe(false);
    }
  );

  spec('11-jamais-200-sans-ecriture-A')(
    '11 — jamais 200 si la commande n’a pas été écrite',
    async () => {
      for (const setup of [
        () => (state.fault = 'error'),
        () => (state.fault = 'throw'),
        () => ((state.fault = null), (state.uniques = [['id']])),
        () => ((state.uniques = [['id'], ['user_id', 'tracking_number']]), (state.fault = null)),
      ]) {
        state.orders = [];
        setup();
        const r = await send(pf, TA, body);
        if (r.status === 200) expect(state.orders).toHaveLength(1);
      }
    }
  );
});
