// P2-6 — le sync n'écrit que ce qui a changé, et ne notifie que les VRAIS
// changements de statut. Mesures avant/après sur données synthétiques.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
const USER = '11111111-1111-4111-8111-111111111111';
const N = 2500; // > 1 000 : au-delà du plafond PostgREST

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  }),
}));

// Colis ZR synthétiques, tous « livrés » (statut notifiable).
let parcels: Array<Record<string, unknown>> = [];
function makeParcels() {
  parcels = Array.from({ length: N }, (_, i) => ({
    trackingNumber: `ZR${String(i).padStart(6, '0')}`,
    customer: { name: `Client ${i}`, phone: { number1: `0550${String(i).padStart(6, '0')}` } },
    deliveryAddress: { city: 'Oran' },
    productsDescription: 'Montre',
    amount: 2500,
    state: { name: 'livre' },
    situation: { name: 'Livré' },
  }));
}

beforeEach(() => {
  db = new FakeSupabase();
  db.maxRows = 1000; // plafond PostgREST de Supabase
  db.seed('public', 'profiles', [{ id: USER, plan_id: 'business', role: 'admin' }]);
  // Clé ZR stockée : lue en base par la route depuis P2-9 phase 1 (celle du
  // corps est alors ignorée) ; sans effet sur la version antérieure.
  db.seed('public', 'user_sync_settings', [
    {
      user_id: USER,
      zrexpress_token: 'zr-synthetic',
      zrexpress_tenant_id: 'zr-tenant',
      notify_enabled: {},
    },
  ]);
  makeParcels();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/parcels/search')) {
        return Response.json({ items: parcels, totalPages: 1, hasNext: false });
      }
      return Response.json({});
    })
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function sync() {
  const { POST } = await import('@/app/api/sync-zrexpress/route');
  const res = await POST(
    new NextRequest('https://app.test/api/sync-zrexpress', {
      method: 'POST',
      body: JSON.stringify({ token: 'zr-synthetic', tenantId: 'zr-tenant' }),
    })
  );
  return { status: res.status, json: await res.json() };
}

/** Lignes de `orders` écrites (insert/upsert/update) depuis `since`. */
const orderWrites = (since: number) =>
  db.writes
    .slice(since)
    .filter((w) => w.table === 'public.orders')
    .reduce((n, w) => n + w.rows.length, 0);

describe('sync sans changement', () => {
  it('2e passage identique : 0 ligne écrite (avant : toutes)', async () => {
    await sync(); // 1er passage : crée les N commandes
    expect(db.all('public', 'orders')).toHaveLength(N);

    const mark = db.writes.length;
    const { status } = await sync();
    expect(status).toBe(200);
    expect(orderWrites(mark)).toBe(0);
  });

  it('aucune notification pour des colis dont le statut n’a pas changé', async () => {
    await sync();
    // Cas réel : commandes EXISTANTES sans ligne de notification (créées avant
    // l'activation des notifications, ou file purgée). Rien ne doit partir
    // pour elles tant que leur statut ne change pas.
    (db as unknown as { rows: (t: string) => unknown[] }).rows(
      'public.pending_notifications'
    ).length = 0;
    const before = 0;
    const marker = db.writes.length;
    await sync();
    const inserted = db.writes
      .slice(marker)
      .filter((w) => w.table === 'public.pending_notifications')
      .reduce((n, w) => n + w.rows.length, 0);
    expect(inserted).toBe(0);
    expect(db.all('public', 'pending_notifications')).toHaveLength(before);
  });
});

describe('sync avec changements', () => {
  it('un seul colis change de statut : 1 écriture, 1 notification', async () => {
    await sync();
    const mark = db.writes.length;
    const pendingBefore = db.all('public', 'pending_notifications').length;

    parcels[1234] = {
      ...parcels[1234],
      state: { name: 'retourne' },
      situation: { name: 'Retourné' },
    };
    await sync();

    expect(orderWrites(mark)).toBe(1);
    expect(db.all('public', 'pending_notifications').length - pendingBefore).toBe(1);
  });

  it('un nouveau colis : 1 écriture (création)', async () => {
    await sync();
    const mark = db.writes.length;
    parcels.push({ ...parcels[0], trackingNumber: 'ZRNEW00001' });
    const { json } = await sync();
    expect(orderWrites(mark)).toBe(1);
    expect(json.created).toBe(1);
    expect(json.unchanged).toBe(N);
  });
});

describe('lecture de l’existant en échec', () => {
  it('repli : tout est écrit comme avant, mais AUCUNE notification (dans le doute)', async () => {
    await sync();
    const pendingBefore = db.all('public', 'pending_notifications').length;
    parcels[7] = { ...parcels[7], state: { name: 'retourne' }, situation: { name: 'Retourné' } };
    // 1re lecture = comptage du quota mensuel ; 2e = lecture de l'existant.
    db.failNext('public', 'orders', 'select');
    db.failNext('public', 'orders', 'select');
    const mark = db.writes.length;
    const { status } = await sync();
    expect(status).toBe(200);
    expect(orderWrites(mark)).toBe(N);
    expect(db.all('public', 'pending_notifications')).toHaveLength(pendingBefore);
  });
});

describe('handler de file zrexpress.sync (même module)', () => {
  it('2e passage identique : 0 ligne écrite ; aucune notification fantôme', async () => {
    db.seed('public', 'user_sync_settings', [
      {
        user_id: USER,
        zrexpress_token: 'zr-synthetic',
        zrexpress_tenant_id: 'zr-tenant',
        notify_enabled: {},
      },
    ]);
    const { handleZrexpressSync } = await import('@/lib/queue/handlers/zrexpress-sync');
    const job = { tenant_id: USER, type: 'zrexpress.sync', payload: {} } as never;
    await handleZrexpressSync(job);
    expect(db.all('public', 'orders')).toHaveLength(N);
    (db as unknown as { rows: (t: string) => unknown[] }).rows(
      'public.pending_notifications'
    ).length = 0;

    const mark = db.writes.length;
    await handleZrexpressSync(job);
    expect(orderWrites(mark)).toBe(0);
    expect(db.all('public', 'pending_notifications')).toHaveLength(0);
  });
});
