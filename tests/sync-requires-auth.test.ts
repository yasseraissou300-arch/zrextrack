// /api/sync-zrexpress sans session : refus, aucun appel ZRExpress, aucune écriture.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
let currentUser: { id: string } | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
}));

const fetchMock = vi.fn(async () =>
  Response.json({
    items: [{ trackingNumber: 'ZR1', state: { name: 'livre' } }],
    totalPages: 1,
    hasNext: false,
  })
);

beforeEach(() => {
  db = new FakeSupabase();
  currentUser = null;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function sync() {
  const { POST } = await import('@/app/api/sync-zrexpress/route');
  return POST(
    new NextRequest('https://app.test/api/sync-zrexpress', {
      method: 'POST',
      body: JSON.stringify({ token: 'zr-key-test', tenantId: 'zr-tenant-test' }),
    })
  );
}

describe('sync ZRExpress — authentification', () => {
  it('sans session : 401, aucun appel ZRExpress, aucune ligne orpheline', async () => {
    const res = await sync();
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.all('public', 'orders')).toHaveLength(0);
  });

  it('avec session : les commandes sont rattachées à l’utilisateur', async () => {
    currentUser = { id: '11111111-1111-4111-8111-111111111111' };
    db.seed('public', 'profiles', [{ id: currentUser.id, plan_id: 'pro', role: null }]);
    const res = await sync();
    expect(res.status).toBe(200);
    const orders = db.all('public', 'orders');
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.user_id === currentUser!.id)).toBe(true);
  });
});
