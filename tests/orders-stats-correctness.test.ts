// Statistiques de commandes : date de changement d'état et pagination.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import { mapParcel, stateUpdatedAt } from '@/lib/zrexpress/map-parcel';

let db: FakeSupabase;
const TENANT = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: TENANT } } }) },
  }),
}));

const SYNC = '2026-09-24T10:00:00.000Z';

describe('last_update = date ZR du dernier changement d’état', () => {
  it('utilise lastStateUpdateAt (SearchSupplierParcelResponse)', () => {
    expect(stateUpdatedAt({ lastStateUpdateAt: '2026-08-02T09:15:00Z' }, SYNC)).toBe(
      '2026-08-02T09:15:00.000Z'
    );
  });

  it('à défaut lastStateHistoryAt, puis l’instant du sync', () => {
    expect(stateUpdatedAt({ lastStateHistoryAt: '2026-08-03T00:00:00Z' }, SYNC)).toBe(
      '2026-08-03T00:00:00.000Z'
    );
    expect(stateUpdatedAt({}, SYNC)).toBe(SYNC);
    expect(stateUpdatedAt({ lastStateUpdateAt: 'pas une date' }, SYNC)).toBe(SYNC);
  });

  it('mapParcel ne tamponne plus toutes les lignes avec l’heure du sync', () => {
    const row = mapParcel(
      {
        trackingNumber: 'ZR1',
        lastStateUpdateAt: '2026-07-01T12:00:00Z',
        state: { name: 'livre' },
      },
      SYNC
    );
    expect(row.last_update).toBe('2026-07-01T12:00:00.000Z');
  });
});

describe('/api/stats — au-delà de 1 000 commandes', () => {
  beforeEach(() => {
    db = new FakeSupabase();
    db.maxRows = 1000; // comme PostgREST sur Supabase
  });

  it('la répartition porte sur TOUTES les commandes', async () => {
    const old = '2026-01-01T00:00:00Z';
    db.seed(
      'public',
      'orders',
      Array.from({ length: 2500 }, (_, i) => ({
        user_id: TENANT,
        tracking_number: `ZR${i}`,
        delivery_status: i % 2 ? 'livre' : 'retourne',
        last_update: old,
      }))
    );
    const { GET } = await import('@/app/api/stats/route');
    const json = await (await GET()).json();
    const total = Object.values(json.distribution as Record<string, number>).reduce(
      (a, b) => a + b,
      0
    );
    expect(total).toBe(2500);
    expect(json.distribution.livre).toBe(1250);
  });

  it('« aujourd’hui » ne compte que les commandes changées aujourd’hui', async () => {
    const now = new Date().toISOString();
    db.seed('public', 'orders', [
      { user_id: TENANT, tracking_number: 'A', delivery_status: 'livre', last_update: now },
      {
        user_id: TENANT,
        tracking_number: 'B',
        delivery_status: 'livre',
        last_update: '2026-01-01T00:00:00Z',
      },
    ]);
    const { GET } = await import('@/app/api/stats/route');
    const json = await (await GET()).json();
    expect(json.today.livrees).toBe(1);
  });
});
