// P4 — REPRODUCTION (constat) des erreurs avalées des webhooks Shopify / WooCommerce.
//
// Ce fichier décrit le comportement ACTUEL (main) — il n'est pas une
// spécification : chaque test marqué « BUG » deviendra rouge le jour où la
// correction (erreurs + onConflict, après HUMAN-ONCONFLICT-001) sera faite ;
// il faudra alors le supprimer au profit de tests/webhook-error-spec.test.ts.
// Aucun code de production modifié. Données entièrement synthétiques.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type UpsertMode =
  | 'ok'
  | 'error'
  | 'throw'
  | 'undefined'
  | 'reject-string'
  | 'error-sans-code'
  | 'status-500-sans-error';

const state = {
  mode: 'ok' as UpsertMode,
  lookup: 'ok' as 'ok' | 'db-error',
  calls: [] as Array<{ row: Row; onConflict: string }>,
};

async function upsert(row: Row, opts: { onConflict: string }) {
  state.calls.push({ row, onConflict: opts.onConflict });
  switch (state.mode) {
    case 'ok':
      return { data: null, error: null, status: 201 };
    case 'error':
      return {
        data: null,
        error: { code: '08006', message: 'connection failure on relation "orders"' },
        status: 503,
      };
    case 'throw':
      throw new Error('socket hang up (simulé)');
    case 'undefined':
      return undefined;
    case 'reject-string':
      return Promise.reject('fetch failed (simulé)');
    case 'error-sans-code':
      return { data: null, error: { message: 'unexpected' }, status: 500 };
    case 'status-500-sans-error':
      return { data: null, error: null, status: 500 };
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (t: string) => {
      if (t === 'orders') return { upsert };
      const q = {
        select: () => q,
        eq: () => q,
        single: async () =>
          state.lookup === 'db-error'
            ? { data: null, error: { code: '08006', message: 'connection failure' } }
            : { data: { user_id: TENANT, secret_key: SECRET }, error: null },
      };
      return q;
    },
  }),
}));

const TENANT = '11111111-1111-4111-8111-111111111111';
const SECRET = 'whsec-repro';

const P = {
  shopify: {
    path: '@/app/api/integrations/shopify/webhook/route',
    head: (sig: string) => ({
      'x-shopify-shop-domain': 'a.test',
      'x-shopify-topic': 'orders/create',
      'x-shopify-hmac-sha256': sig,
    }),
    body: JSON.stringify({
      id: 1001,
      name: '#1001',
      financial_status: 'paid',
      fulfillment_status: null,
      total_price: '900',
      line_items: [{ name: 'Montre' }],
    }),
    tracking: 'SHO-1001',
  },
  woocommerce: {
    path: '@/app/api/integrations/woocommerce/webhook/route',
    head: (sig: string) => ({
      'x-wc-webhook-source': 'a.test',
      'x-wc-webhook-topic': 'order.created',
      'x-wc-webhook-signature': sig,
    }),
    body: JSON.stringify({
      id: 2002,
      number: 2002,
      status: 'processing',
      total: '900',
      line_items: [{ name: 'Montre' }],
    }),
    tracking: 'WOO-2002',
  },
} as const;
type Platform = keyof typeof P;

const sign = (b: string) => crypto.createHmac('sha256', SECRET).update(b, 'utf8').digest('base64');

async function send(pf: Platform, body: string = P[pf].body) {
  const { POST } = (await import(/* @vite-ignore */ P[pf].path)) as {
    POST: (r: NextRequest) => Promise<Response>;
  };
  const res = await POST(
    new NextRequest(`https://app.test/api/integrations/${pf}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...P[pf].head(sign(body)) },
      body,
    })
  );
  return { status: res.status, json: await res.json() };
}

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  state.mode = 'ok';
  state.lookup = 'ok';
  state.calls = [];
  logs = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {})
  );
});
afterEach(() => vi.restoreAllMocks());
const nothingLogged = () => logs.every((s) => s.mock.calls.length === 0);

describe.each(Object.keys(P) as Platform[])('%s — comportement ACTUEL (main)', (pf) => {
  it('R1 upsert réussi → 200 {ok:true}, une écriture', async () => {
    const r = await send(pf);
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].row.tracking_number).toBe(P[pf].tracking);
    expect(state.calls[0].row.user_id).toBe(TENANT);
  });

  it("R2 BUG — Supabase renvoie { error } → 200 {ok:true}, aucun journal", async () => {
    state.mode = 'error';
    const r = await send(pf);
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(state.calls).toHaveLength(1);
    expect(nothingLogged()).toBe(true);
  });

  it('R3 BUG — exception pendant l’upsert → 200 {ok:true}, aucun journal', async () => {
    state.mode = 'throw';
    const r = await send(pf);
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(nothingLogged()).toBe(true);
  });

  it.each([
    'undefined',
    'reject-string',
    'error-sans-code',
    'status-500-sans-error',
  ] as const)('R4 BUG — résultat inattendu (%s) → 200 {ok:true}, aucun journal', async (mode) => {
    state.mode = mode;
    const r = await send(pf);
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(nothingLogged()).toBe(true);
  });

  it('R5 BUG — JSON invalide mais correctement signé → 200 {ok:true}, aucune écriture', async () => {
    const r = await send(pf, '{pas du json');
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(state.calls).toHaveLength(0);
  });

  it('R6 constat E4 — panne base pendant la recherche de l’intégration → 404 (et non 5xx)', async () => {
    state.lookup = 'db-error';
    const r = await send(pf);
    expect(r.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("R7 preuve CODE — la cible envoyée est onConflict 'tracking_number' (globale, sans user_id)", async () => {
    await send(pf);
    expect(state.calls[0].onConflict).toBe('tracking_number');
  });
});
