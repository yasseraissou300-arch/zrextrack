// /api/orders (liste du dashboard) — pagination, recherche et erreurs.
//
// VRAI client supabase-js, transport HTTP capturé : on vérifie la requête
// EXACTE envoyée à PostgREST (aucune base réelle).
//   1. tri stable (last_update puis id) : sans départage, des commandes au même
//      last_update apparaissent en double ou jamais en naviguant ;
//   2. page / pageSize bornés (page=0, abc, pageSize énorme → plus de 500) ;
//   3. recherche citée dans .or() : virgule, parenthèse, guillemet ne cassent
//      plus la requête et ne sont plus interprétés comme syntaxe de filtre ;
//   4. erreur PostgREST : message générique, jamais le texte brut.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient as createSupabase } from '@supabase/supabase-js';

const ME = '11111111-1111-4111-8111-111111111111';
const VICTIM = '22222222-2222-4222-8222-222222222222';

let requests: URLSearchParams[] = [];
let failWith: { status: number; body: unknown } | null = null;

const transport = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  requests.push(url.searchParams);
  const headers = new Headers({ 'content-type': 'application/json', 'content-range': '0-0/0' });
  if (failWith)
    return new Response(JSON.stringify(failWith.body), { status: failWith.status, headers });
  return new Response('[]', { status: 200, headers });
});

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () =>
    createSupabase('http://pg.test', 'service-role-test-key', {
      global: { fetch: transport as unknown as typeof fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));

import { GET } from '@/app/api/orders/route';

const get = (qs: Record<string, string>) =>
  GET(new NextRequest(`https://app.test/api/orders?${new URLSearchParams(qs)}`));

beforeEach(() => {
  requests = [];
  failWith = null;
  transport.mockClear();
  for (const m of ['log', 'info', 'warn', 'error'] as const)
    vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('/api/orders — tri stable', () => {
  it('ordre = last_update desc PUIS id desc (départage des égalités)', async () => {
    await get({ page: '2', pageSize: '10' });
    expect(requests[0].get('order')).toBe('last_update.desc,id.desc');
    expect(requests[0].get('offset')).toBe('10');
    expect(requests[0].get('limit')).toBe('10');
  });
});

describe('/api/orders — page et pageSize bornés', () => {
  it.each([
    [{ page: '0', pageSize: '10' }, '0', '10'],
    [{ page: '-5', pageSize: '10' }, '0', '10'],
    [{ page: 'abc', pageSize: 'xyz' }, '0', '10'],
    [{ page: '1', pageSize: '100000' }, '0', '100'],
    [{ page: '3', pageSize: '0' }, '2', '1'],
  ])('%o → offset %s, limit %s, réponse 200', async (qs, offset, limit) => {
    const res = await get(qs as Record<string, string>);
    expect(res.status).toBe(200);
    expect(requests[0].get('offset')).toBe(offset);
    expect(requests[0].get('limit')).toBe(limit);
  });

  it('pageSize 10 / 15 / 25 / 50 / 100 (valeurs de l’interface) inchangés', async () => {
    for (const size of ['10', '15', '25', '50', '100']) {
      requests = [];
      await get({ page: '1', pageSize: size });
      expect(requests[0].get('limit')).toBe(size);
    }
  });
});

describe('/api/orders — recherche', () => {
  it('virgule et parenthèses : valeur citée, une seule expression or()', async () => {
    await get({ search: 'Benali, Amine (Oran)' });
    expect(requests[0].get('or')).toBe(
      '(tracking_number.ilike."%Benali, Amine (Oran)%",customer_name.ilike."%Benali, Amine (Oran)%")'
    );
  });

  it('guillemet et barre oblique inverse échappés', async () => {
    await get({ search: 'a"b\\c' });
    expect(requests[0].get('or')).toBe(
      '(tracking_number.ilike."%a\\"b\\\\c%",customer_name.ilike."%a\\"b\\\\c%")'
    );
  });

  it('tentative d’injection : reste UNE valeur citée, le scope user_id reste appliqué', async () => {
    await get({ search: `x%,user_id.eq.${VICTIM},id.not.is.null` });
    const p = requests[0];
    expect(p.get('or')).toBe(
      `(tracking_number.ilike."%x%,user_id.eq.${VICTIM},id.not.is.null%",customer_name.ilike."%x%,user_id.eq.${VICTIM},id.not.is.null%")`
    );
    expect(p.getAll('user_id')).toEqual([`eq.${ME}`]);
  });

  it('recherche bornée à 100 caractères et espaces retirés', async () => {
    await get({ search: `  ${'Z'.repeat(250)}  ` });
    expect(requests[0].get('or')).toContain(`"%${'Z'.repeat(100)}%"`);
    expect(requests[0].get('or')).not.toContain('Z'.repeat(101));
  });

  it('recherche vide → pas de filtre or', async () => {
    await get({ search: '   ' });
    expect(requests[0].has('or')).toBe(false);
  });
});

describe('/api/orders — erreurs', () => {
  it('erreur PostgREST → 500 générique, jamais le texte brut', async () => {
    failWith = {
      status: 400,
      body: {
        code: 'PGRST100',
        message: '"failed to parse logic tree ((tracking_number.ilike.%x)%" orders',
      },
    };
    const res = await get({ search: 'x' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Erreur de lecture des commandes' });
    expect(JSON.stringify(body)).not.toMatch(/logic tree|orders|tracking_number/);
  });
});

describe('/api/orders — onglets de statut', () => {
  it('en_cours = préparation + transit + livraison (un seul filtre in)', async () => {
    await get({ status: 'en_cours' });
    expect(requests[0].get('delivery_status')).toBe('in.(en_preparation,en_transit,en_livraison)');
    expect(requests[0].get('user_id')).toBe(`eq.${ME}`);
  });

  it('statut simple inchangé', async () => {
    await get({ status: 'livre' });
    expect(requests[0].get('delivery_status')).toBe('eq.livre');
  });
});
