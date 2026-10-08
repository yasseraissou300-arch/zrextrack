// Double envoi ENTRE CHEMINS : drain « client » (/api/sync-zrexpress) et file
// autotim (`zrexpress.sync` → job `whatsapp.send`) lisent tous deux les lignes
// `pending` de public.pending_notifications.
//
// Scénario réel (tenant sync_source = 'server' ou 'both', onglet ouvert) :
//   T0      tick : enqueuePendingNotifications lit la notif N (pending) et
//           enfile un job whatsapp.send pour T0 + 20-60 s ;
//   T0+5 s  onglet : /api/sync-zrexpress draine N → envoi WhatsApp, N = sent ;
//   T0+40 s job : envoyait N une SECONDE fois sans relire son statut.
//
// Correctif : le job réclame la notification (pending → sending, CAS scopé au
// tenant) juste avant l'appel Evolution ; s'il ne l'obtient pas, il s'arrête
// sans envoyer. max_attempts = 1 : aucune relance, donc aucun rejeu.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeSupabase } from '../helpers/fake-supabase';
import type { Job } from '@/lib/queue/types';

let fake: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fake,
  createClient: async () => {
    throw new Error('createClient (cookies) ne doit jamais être appelé par la file');
  },
}));

import { handleWhatsAppSend } from '@/lib/queue/handlers/whatsapp-send';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const EVOLUTION_URL = 'https://evolution.test';
const NOTIF_ID = 'notif-1';

let evolutionCalls: string[];

function makeJob(notificationId: string | null = NOTIF_ID, tenant = TENANT_A): Job {
  return {
    id: 'job-claim',
    tenant_id: tenant,
    type: 'whatsapp.send',
    payload: {
      phone: '0556 17 26 74',
      message: 'Salam, colis ZR-1 wsel.',
      tracking_number: 'ZR-1',
      customer_name: 'Test',
      ...(notificationId ? { notification_id: notificationId } : {}),
    },
    status: 'running',
    run_after: new Date().toISOString(),
    attempts: 1,
    max_attempts: 1,
    locked_at: new Date().toISOString(),
    locked_by: 'w',
    last_error: null,
    idempotency_key: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function seed(status: string, owner = TENANT_A) {
  fake.seed('public', 'whatsapp_instances', [
    {
      user_id: TENANT_A,
      instance_name: 'inst-1111',
      service_type: 'auto_confirmation',
      connected: true,
    },
  ]);
  fake.seed('public', 'pending_notifications', [
    {
      id: NOTIF_ID,
      user_id: owner,
      tracking_number: 'ZR-1',
      delivery_status: 'livre',
      customer_whatsapp: '0556 17 26 74',
      status,
    },
  ]);
}

function notifStatus(): string {
  return fake.all('public', 'pending_notifications').find((r: any) => r.id === NOTIF_ID)!.status;
}

beforeEach(() => {
  fake = new FakeSupabase();
  evolutionCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      const url = String(input);
      if (!url.startsWith(EVOLUTION_URL)) throw new Error(`appel réseau interdit : ${url}`);
      evolutionCalls.push(url);
      return new Response('{}', { status: 201 });
    })
  );
  vi.stubEnv('EVOLUTION_API_URL', EVOLUTION_URL);
  vi.stubEnv('EVOLUTION_API_KEY', 'test-key');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('whatsapp.send — prise atomique de la notification avant envoi', () => {
  it('notification déjà envoyée par le drain client (sent) → AUCUN envoi, job terminé', async () => {
    seed('sent');
    const r = await handleWhatsAppSend(makeJob());
    expect(evolutionCalls).toHaveLength(0);
    expect(r).toEqual({ outcome: 'done' });
    expect(fake.all('public', 'messages')).toHaveLength(0);
    expect(notifStatus()).toBe('sent');
  });

  it('notification en cours d’envoi par le drain client (sending) → AUCUN envoi', async () => {
    seed('sending');
    await handleWhatsAppSend(makeJob());
    expect(evolutionCalls).toHaveLength(0);
    expect(notifStatus()).toBe('sending');
  });

  it('notification en échec (failed) → AUCUN renvoi automatique', async () => {
    seed('failed');
    await handleWhatsAppSend(makeJob());
    expect(evolutionCalls).toHaveLength(0);
  });

  it('notification pending → réclamée, envoyée UNE fois, marquée sent', async () => {
    seed('pending');
    const r = await handleWhatsAppSend(makeJob());
    expect(r).toEqual({ outcome: 'done' });
    expect(evolutionCalls).toHaveLength(1);
    expect(notifStatus()).toBe('sent');
    expect(fake.all('public', 'messages')).toHaveLength(1);
  });

  it('deux jobs concurrents sur la même notification → un seul envoi', async () => {
    seed('pending');
    await Promise.all([handleWhatsAppSend(makeJob()), handleWhatsAppSend(makeJob())]);
    expect(evolutionCalls).toHaveLength(1);
  });

  it('notification d’un AUTRE tenant → jamais réclamée ni envoyée (scope tenant)', async () => {
    seed('pending', TENANT_B);
    await handleWhatsAppSend(makeJob());
    expect(evolutionCalls).toHaveLength(0);
    expect(notifStatus()).toBe('pending');
  });

  it('job sans notification_id (campagne) → comportement inchangé : envoi', async () => {
    seed('pending');
    await handleWhatsAppSend(makeJob(null));
    expect(evolutionCalls).toHaveLength(1);
    expect(notifStatus()).toBe('pending');
  });
});
