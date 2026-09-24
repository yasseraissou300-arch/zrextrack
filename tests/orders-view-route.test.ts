// /api/orders/view — remplace la lecture directe de `orders` depuis le
// navigateur (RLS 42P17 → HTTP 500 → pages Alertes / Clients / Livraisons /
// Rapports vides). Enjeu principal : isolation stricte entre comptes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

const fake = new FakeSupabase();
let sessionUser: { id: string } | null = { id: 'A' };
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
  createServiceClient: () => fake,
}));

const { GET } = await import('@/app/api/orders/view/route');
const call = async (view?: string) => {
  const u = new URL('https://x.test/api/orders/view');
  if (view) u.searchParams.set('view', view);
  const res = await GET(new NextRequest(u));
  return { status: res.status, body: await res.json() };
};

let n = 0;
const order = (o: Record<string, unknown>) => ({
  id: `o${String(n++).padStart(6, '0')}`,
  user_id: 'A',
  deleted_at: null,
  delivery_status: 'livre',
  customer_name: 'C',
  customer_whatsapp: '213',
  wilaya: 'Alger',
  cod: 1000,
  created_at: '2026-09-01T00:00:00Z',
  last_update: '2026-09-01T00:00:00Z',
  ...o,
});

beforeEach(() => {
  fake.reset();
  sessionUser = { id: 'A' };
  n = 0;
});

describe('GET /api/orders/view', () => {
  it('401 sans session', async () => {
    sessionUser = null;
    expect((await call('rapports')).status).toBe(401);
  });

  it('400 sur une vue inconnue ou absente (aucune requête libre)', async () => {
    expect((await call('orders; drop')).status).toBe(400);
    expect((await call()).status).toBe(400);
  });

  it('ISOLATION : ne renvoie jamais les commandes d’un autre compte', async () => {
    fake.seed('public', 'orders', [order({ user_id: 'A' }), order({ user_id: 'B' })]);
    const { body } = await call('livraisons');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].user_id).toBe('A');
  });

  it('exclut la corbeille (deleted_at non nul)', async () => {
    fake.seed('public', 'orders', [order({}), order({ deleted_at: '2026-09-02T00:00:00Z' })]);
    expect((await call('rapports')).body.data).toHaveLength(1);
  });

  it('alertes : uniquement echec/retourne, 50 max', async () => {
    fake.seed('public', 'orders', [
      ...Array.from({ length: 60 }, () => order({ delivery_status: 'echec' })),
      order({ delivery_status: 'livre' }),
    ]);
    const { body } = await call('alertes');
    expect(body.data).toHaveLength(50);
    expect(body.data.every((o: any) => o.delivery_status === 'echec')).toBe(true);
  });

  it('livraisons : filtre sur les 4 statuts de livraison', async () => {
    fake.seed('public', 'orders', [
      order({ delivery_status: 'en_livraison' }),
      order({ delivery_status: 'en_preparation' }),
    ]);
    const { body } = await call('livraisons');
    expect(body.data.map((o: any) => o.delivery_status)).toEqual(['en_livraison']);
  });

  it('rapports : pagine au-delà de 1 000 lignes (statistiques non tronquées)', async () => {
    fake.seed(
      'public',
      'orders',
      Array.from({ length: 2500 }, () => order({}))
    );
    const { body } = await call('rapports');
    expect(body.data).toHaveLength(2500);
  });

  it('500 générique sans fuite du message Postgres', async () => {
    fake.seed('public', 'orders', [order({})]);
    fake.failNext('public', 'orders', 'select', { message: 'secret internal detail' });
    const { status, body } = await call('clients');
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });
});
