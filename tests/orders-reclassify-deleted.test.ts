// /api/orders/reclassify et /api/orders/deleted — au-delà de 1 000 lignes,
// et même classification que le sync.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import { mapStatus } from '@/lib/zrexpress/status';

let db: FakeSupabase;
const TENANT = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: TENANT } } }) },
  }),
}));

beforeEach(() => {
  db = new FakeSupabase();
  db.maxRows = 1000; // plafond PostgREST de Supabase
});

async function reclassify() {
  const { POST } = await import('@/app/api/orders/reclassify/route');
  return (await POST()).json();
}

describe('reclassify', () => {
  it('traite TOUTES les commandes (avant : 1 000 au plus)', async () => {
    db.seed(
      'public',
      'orders',
      Array.from({ length: 2500 }, (_, i) => ({
        user_id: TENANT,
        tracking_number: `ZR${i}`,
        delivery_status: 'en_preparation',
        situation: 'Livré',
        deleted_at: null,
      }))
    );
    const json = await reclassify();
    expect(json.total).toBe(2500);
    const expected = mapStatus('', 'Livré');
    expect(db.all('public', 'orders').every((o) => o.delivery_status === expected)).toBe(true);
  });

  it.each(['En attente de confirmation', 'Renvoi', 'Arrivé au hub', 'Non remis'])(
    'situation « %s » : même statut que le sync (fonction partagée)',
    async (situation) => {
      db.seed('public', 'orders', [
        {
          user_id: TENANT,
          tracking_number: 'ZR1',
          delivery_status: 'inconnu',
          situation,
          deleted_at: null,
        },
      ]);
      await reclassify();
      expect(db.all('public', 'orders')[0].delivery_status).toBe(mapStatus('', situation));
    }
  );

  it('le compteur n’inclut que les écritures réussies', async () => {
    db.seed('public', 'orders', [
      {
        user_id: TENANT,
        tracking_number: 'A',
        delivery_status: 'x',
        situation: 'Livré',
        deleted_at: null,
      },
    ]);
    db.failNext('public', 'orders', 'update');
    expect((await reclassify()).updated).toBe(0);
  });
});

describe('corbeille', () => {
  it('renvoie toutes les commandes supprimées (avant : 1 000 au plus)', async () => {
    db.seed(
      'public',
      'orders',
      Array.from({ length: 1500 }, (_, i) => ({
        user_id: TENANT,
        tracking_number: `ZR${i}`,
        deleted_at: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
      }))
    );
    const { GET } = await import('@/app/api/orders/deleted/route');
    const json = await (await GET()).json();
    expect(json.data).toHaveLength(1500);
  });
});
