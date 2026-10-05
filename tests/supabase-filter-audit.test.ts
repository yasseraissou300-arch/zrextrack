// P4 — AUDIT (constat, aucun code modifié) : filtres Supabase construits avec
// des paramètres externes.
//
// Les routes tournent avec un VRAI client supabase-js (@supabase/postgrest-js
// 2.103.1) dont le transport HTTP est capturé : on observe la requête EXACTE
// envoyée à PostgREST, sans base réelle. Faits du client (dist/index.cjs) :
//   - chaque filtre = UN paramètre d'URL distinct (URLSearchParams.append) ;
//     PostgREST combine les paramètres de premier niveau par ET logique ;
//   - .or(f)  → `or=(f)` : f est inséré tel quel (sa syntaxe est interprétée) ;
//   - .in(c,v)→ `c=in.(…)` : guillemets ajoutés si `,()`, guillemets internes
//               NON échappés ;
//   - .eq / .ilike → valeur littérale ; pour ilike, % _ * restent des jokers.
// Base : main (code de production).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient as createSupabase } from '@supabase/supabase-js';

const ME = '11111111-1111-4111-8111-111111111111';
const VICTIM = '22222222-2222-4222-8222-222222222222';

type Captured = { method: string; table: string; params: URLSearchParams; raw: string };
let requests: Captured[] = [];
/** Réponse simulée par table (lignes JSON). */
let rowsFor: (table: string, method: string) => unknown[] = () => [];

const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const method = (init?.method ?? 'GET').toUpperCase();
  requests.push({ method, table, params: url.searchParams, raw: url.search });
  const rows = rowsFor(table, method);
  const headers = new Headers({
    'content-type': 'application/json',
    'content-range': `0-${rows.length}/${rows.length}`,
  });
  const accept = new Headers(init?.headers).get('accept') ?? '';
  if (accept.includes('vnd.pgrst.object')) {
    if (rows.length !== 1) {
      return new Response(JSON.stringify({ code: 'PGRST116', message: 'not one row' }), {
        status: 406,
        headers,
      });
    }
    return new Response(JSON.stringify(rows[0]), { status: 200, headers });
  }
  return new Response(JSON.stringify(rows), { status: 200, headers });
});

const service = () =>
  createSupabase('http://pg.test', 'service-role-test-key', {
    global: { fetch: transport as unknown as typeof fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });

let currentUser: string | null = ME;
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => service(),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser ? { id: currentUser } : null } }) },
  }),
}));

beforeEach(() => {
  requests = [];
  rowsFor = () => [];
  currentUser = ME;
  transport.mockClear();
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {});
  }
});
afterEach(() => vi.restoreAllMocks());

const ordersReq = (qs: Record<string, string>) =>
  new NextRequest(`https://app.test/api/orders?${new URLSearchParams(qs)}`);

// ─── 1. GET /api/orders — `search` concaténé dans .or() ─────────────────────

describe('GET /api/orders — search dans .or()', () => {
  it('la syntaxe injectée est INTERPRÉTÉE dans or=(…), mais user_id=eq.<moi> reste un paramètre ET séparé', async () => {
    const { GET } = await import('@/app/api/orders/route');
    await GET(ordersReq({ search: `x%,user_id.eq.${VICTIM},id.not.is.null` }));
    const q = requests.find((r) => r.table === 'orders')!;
    // Injection prouvée : de nouvelles conditions apparaissent dans le OR.
    expect(q.params.get('or')).toBe(
      `(tracking_number.ilike.%x%,user_id.eq.${VICTIM},id.not.is.null%,customer_name.ilike.%x%,user_id.eq.${VICTIM},id.not.is.null%)`
    );
    // …mais le scope propriétaire est un paramètre de premier niveau, combiné par ET.
    expect(q.params.getAll('user_id')).toEqual([`eq.${ME}`]);
    expect(q.params.get('deleted_at')).toBe('is.null');
  });

  it('« & » ne crée PAS de nouveau paramètre : impossible d’ajouter ou de remplacer user_id', async () => {
    const { GET } = await import('@/app/api/orders/route');
    await GET(ordersReq({ search: `x&user_id=eq.${VICTIM}` }));
    const q = requests.find((r) => r.table === 'orders')!;
    expect(q.params.getAll('user_id')).toEqual([`eq.${ME}`]);
    expect(q.raw).not.toContain(`&user_id=eq.${VICTIM}`);
  });

  it('`situation` passe par .ilike() : jokers actifs (% _ *), toujours sous user_id=eq.<moi>', async () => {
    const { GET } = await import('@/app/api/orders/route');
    await GET(ordersReq({ situation: '%' }));
    const q = requests.find((r) => r.table === 'orders')!;
    expect(q.params.get('situation')).toBe('ilike.%%%');
    expect(q.params.getAll('user_id')).toEqual([`eq.${ME}`]);
  });

  it('sur main, une erreur PostgREST est renvoyée BRUTE au navigateur (error.message)', async () => {
    rowsFor = () => [];
    transport.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            code: 'PGRST100',
            message: 'failed to parse logic tree ((tracking_number.ilike.%x)%)) at public.orders',
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
    );
    const { GET } = await import('@/app/api/orders/route');
    const res = await GET(ordersReq({ search: 'x)' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('failed to parse logic tree');
  });
});

// ─── 2. Suppression / restauration — ids du corps dans .in() ────────────────

describe('POST /api/orders/{delete,restore,delete-permanent} — ids dans .in()', () => {
  it.each(['delete', 'restore', 'delete-permanent'])(
    '%s : guillemet injecté élargit la LISTE, jamais le scope user_id=eq.<moi>',
    async (route) => {
      const { POST } = await import(`@/app/api/orders/${route}/route`);
      await POST(
        new NextRequest(`https://app.test/api/orders/${route}`, {
          method: 'POST',
          body: JSON.stringify({ ids: ['a",b'] }),
        })
      );
      const q = requests.find((r) => r.table === 'orders')!;
      expect(q.params.get('id')).toBe('in.("a",b")'); // guillemet interne non échappé
      expect(q.params.getAll('user_id')).toEqual([`eq.${ME}`]);
    }
  );
});

// ─── 3. Twilio /api/voice-calls/status — `cid` (requête) dans .or() ──────────

describe('POST /api/voice-calls/status — cid dans .or()', () => {
  it('cid forgé : condition injectée dans la LECTURE (or=…), écriture sur la valeur LITTÉRALE → aucune ligne', async () => {
    // Aucune ligne voice_calls pour ce cid → garde en mode « unenforced »
    // (pas d'auth_token) : la requête NON signée passe.
    const cid = `x,user_id.eq.${VICTIM}`;
    rowsFor = (table, method) =>
      table === 'voice_calls' && method === 'GET' && requests.at(-1)?.params.get('or')
        ? [{ outcome: null }]
        : [];
    const { POST } = await import('@/app/api/voice-calls/status/route');
    const res = await POST(
      new NextRequest(`https://app.test/api/voice-calls/status?cid=${encodeURIComponent(cid)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          CallSid: 'CA00000000000000000000000000000001',
          CallStatus: 'no-answer',
        }).toString(),
      })
    );
    expect(res.status).toBe(200);
    const read = requests.find((r) => r.table === 'voice_calls' && r.params.get('or'))!;
    expect(read.params.get('or')).toBe(`(id.eq.x,user_id.eq.${VICTIM})`); // injection prouvée
    const write = requests.find((r) => r.table === 'voice_calls' && r.method === 'PATCH')!;
    expect(write.params.get('id')).toBe(`eq.${cid}`); // littéral : ne correspond à aucun uuid
    expect(write.params.get('or')).toBeNull();
    // Le résultat de la lecture n'est jamais renvoyé au client.
    expect(await res.json()).toEqual({ ok: true });
  });
});

// ─── 4. /api/track (main) — saisie publique dans .ilike(), sans scope ───────

describe('GET /api/track/[tracking] (main, PUBLIC)', () => {
  it('« % » devient un joker : filtre tracking_number=ilike.%, AUCUN scope marchand → n’importe quelle commande', async () => {
    rowsFor = (table) =>
      table === 'orders'
        ? [
            {
              tracking_number: 'ZR-VICTIME',
              customer_name: 'Client Victime',
              wilaya: 'Oran',
              delivery_status: 'livre',
            },
          ]
        : [];
    const { GET } = await import('@/app/api/track/[tracking]/route');
    const res = await GET(
      new NextRequest('https://app.test/api/track/%25', {
        headers: { 'x-forwarded-for': '203.0.113.7' },
      }),
      { params: Promise.resolve({ tracking: '%' }) }
    );
    const q = requests.find((r) => r.table === 'orders')!;
    expect(q.params.get('tracking_number')).toBe('ilike.%');
    expect(q.params.get('user_id')).toBeNull();
    expect(res.status).toBe(200);
    expect((await res.json()).tracking).toBe('ZR-VICTIME');
  });
});
