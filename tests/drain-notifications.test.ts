// Drain pending_notifications — double envoi sous concurrence.
//
// Scénario réel : le tenant pilote est en sync « client ». Chaque onglet
// ouvert (PC + téléphone, deux onglets, « Sync maintenant » pendant
// l'auto-sync) appelle /api/sync-zrexpress, qui draine la file. L'ancien code
// lisait les lignes « pending », envoyait, puis marquait « sent » : deux appels
// simultanés envoyaient chacun la même notification au même client.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';

vi.mock('@/lib/whatsapp/anti-spam', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/anti-spam')>();
  return { ...actual, sleep: async () => {} }; // pas d'attente réelle de 8 s
});

import {
  drainNotifications,
  claimNotification,
  DRAIN_PER_SYNC,
  NOTIF_CLAIMED_STATUS,
} from '@/lib/whatsapp/drain-notifications';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

let db: FakeSupabase;
const sends: Array<{ number: string; text: string }> = [];

// Evolution simulé : répond après un tour de boucle d'événements, comme un
// vrai appel réseau — c'est ce délai qui ouvre la fenêtre de concurrence.
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  await new Promise((r) => setTimeout(r, 5));
  sends.push(JSON.parse(String(init?.body)));
  return new Response('{}', { status: 200 });
});

function seedTenant(tenant: string, notifs: number) {
  db.seed('public', 'profiles', [{ id: tenant, whatsapp_warmup_started_at: null }]);
  db.seed('public', 'whatsapp_instances', [
    {
      user_id: tenant,
      service_type: 'auto_confirmation',
      instance_name: `inst_${tenant.slice(0, 4)}`,
    },
  ]);
  db.seed(
    'public',
    'pending_notifications',
    Array.from({ length: notifs }, (_, i) => ({
      id: `${tenant.slice(0, 4)}-n${i}`,
      user_id: tenant,
      tracking_number: `TRK${i}`,
      delivery_status: 'en_livraison',
      customer_name: `Client ${i}`,
      customer_whatsapp: `055000000${i}`,
      wilaya: 'Oran',
      product_name: 'Produit',
      cod: 2500,
      status: 'pending',
      created_at: new Date(Date.UTC(2026, 8, 24, 8, i)).toISOString(),
    }))
  );
}

beforeEach(() => {
  db = new FakeSupabase();
  sends.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('EVOLUTION_API_URL', 'https://evolution.test');
  vi.stubEnv('EVOLUTION_API_KEY', 'global-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const drain = (tenant: string) => drainNotifications(db as any, tenant, new Map());

describe('drain — concurrence entre deux syncs', () => {
  it('deux syncs simultanés n’envoient jamais deux fois la même notification', async () => {
    seedTenant(TENANT_A, 2);

    const [a, b] = await Promise.all([drain(TENANT_A), drain(TENANT_A)]);

    expect(a + b).toBe(2);
    expect(sends).toHaveLength(2);
    const numbers = sends.map((s) => s.number);
    expect(new Set(numbers).size).toBe(numbers.length); // aucun destinataire en double
  });

  it('cinq syncs simultanés : chaque notification part exactement une fois', async () => {
    seedTenant(TENANT_A, 3);

    // Les 5 lisent les mêmes DRAIN_PER_SYNC plus anciennes : 2 envois, pas 10.
    await Promise.all(Array.from({ length: 5 }, () => drain(TENANT_A)));
    expect(sends.map((s) => s.number).sort()).toEqual(['213550000000', '213550000001']);

    // La 3e part au sync suivant, une seule fois elle aussi.
    await Promise.all(Array.from({ length: 5 }, () => drain(TENANT_A)));
    const numbers = sends.map((s) => s.number).sort();
    expect(numbers).toEqual(['213550000000', '213550000001', '213550000002']);
    const rows = db.all('public', 'pending_notifications');
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
  });

  it('un journal `messages` par envoi réel, pas par sync', async () => {
    seedTenant(TENANT_A, 2);
    await Promise.all([drain(TENANT_A), drain(TENANT_A)]);
    expect(db.all('public', 'messages')).toHaveLength(2);
  });
});

describe('drain — comportement inchangé', () => {
  it('respecte DRAIN_PER_SYNC par appel', async () => {
    seedTenant(TENANT_A, 5);
    const n = await drain(TENANT_A);
    expect(n).toBe(DRAIN_PER_SYNC);
    expect(sends).toHaveLength(DRAIN_PER_SYNC);
  });

  it('respecte le plafond journalier : quota épuisé → aucun envoi', async () => {
    seedTenant(TENANT_A, 2);
    db.seed(
      'public',
      'messages',
      Array.from({ length: 40 }, () => ({
        user_id: TENANT_A,
        status: 'envoye',
        sent_at: new Date().toISOString(),
      }))
    );
    expect(await drain(TENANT_A)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('échec Evolution → ligne « failed », journal « echec », jamais renvoyée', async () => {
    seedTenant(TENANT_A, 1);
    fetchMock.mockImplementationOnce(async () => new Response('down', { status: 500 }));
    expect(await drain(TENANT_A)).toBe(0);
    expect(db.all('public', 'pending_notifications')[0].status).toBe('failed');
    expect(await drain(TENANT_A)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('numéro 00213… correctement normalisé (l’ancienne copie produisait 2130213…)', async () => {
    seedTenant(TENANT_A, 1);
    const row = db.all('public', 'pending_notifications')[0];
    row.customer_whatsapp = '00213550000009';
    await drain(TENANT_A);
    expect(sends[0].number).toBe('213550000009');
  });
});

describe('prise atomique', () => {
  it('une seule prise réussit sur la même ligne', async () => {
    seedTenant(TENANT_A, 1);
    const [x, y] = await Promise.all([
      claimNotification(db as any, TENANT_A, `${TENANT_A.slice(0, 4)}-n0`),
      claimNotification(db as any, TENANT_A, `${TENANT_A.slice(0, 4)}-n0`),
    ]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    expect(db.all('public', 'pending_notifications')[0].status).toBe(NOTIF_CLAIMED_STATUS);
  });

  it('un tenant ne peut pas prendre la notification d’un autre', async () => {
    seedTenant(TENANT_A, 1);
    seedTenant(TENANT_B, 0);
    expect(await claimNotification(db as any, TENANT_B, `${TENANT_A.slice(0, 4)}-n0`)).toBe(false);
    expect(db.all('public', 'pending_notifications')[0].status).toBe('pending');
  });

  it('erreur base pendant la prise → pas d’envoi (dans le doute, on s’abstient)', async () => {
    seedTenant(TENANT_A, 1);
    db.failNext('public', 'pending_notifications', 'update');
    expect(await drain(TENANT_A)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
