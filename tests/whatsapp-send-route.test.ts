// /api/whatsapp/send (envoi manuel depuis la page Messages) + sélection des
// messages à renvoyer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';
import { selectResendable, type MessageLogRow } from '@/lib/whatsapp/resend-selection';

let db: FakeSupabase;
const TENANT = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: TENANT } } }) },
  }),
  createServiceClient: () => db,
}));
vi.mock('@/lib/user-creds', () => ({
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'global-key' }),
}));
// Temps simulé : le throttle avance l'horloge au lieu d'attendre réellement.
vi.mock('@/lib/whatsapp/anti-spam', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/anti-spam')>();
  return {
    ...actual,
    randomThrottle: () => 30_000,
    sleep: async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    },
  };
});

const sends: string[] = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.includes('/instance/connectionState/')) return Response.json({ state: 'open' });
  if (url.includes('/message/sendText/')) {
    sends.push(JSON.parse(String(init?.body)).number);
    return new Response('{}');
  }
  return new Response('{}');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
  db = new FakeSupabase();
  sends.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  db.seed('public', 'whatsapp_instances', [
    {
      user_id: TENANT,
      service_type: 'auto_confirmation',
      instance_name: 'zrex_111111111111_auto',
      connected: true,
    },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function recipients(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    tracking: `TRK${i}`,
    client: `Client ${i}`,
    whatsapp: `055000000${i}`,
    message: `Bonjour ${i}`,
  }));
}

async function send(n: number) {
  const { POST } = await import('@/app/api/whatsapp/send/route');
  const res = await POST(
    new NextRequest('https://app.test/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({ recipients: recipients(n) }),
    })
  );
  return { status: res.status, json: await res.json() };
}

describe('warm-up appliqué à l’envoi manuel', () => {
  it('jour 1 de warm-up (plafond 8) : 8 envois déjà faits → refus', async () => {
    db.seed('public', 'profiles', [
      { id: TENANT, whatsapp_warmup_started_at: '2026-09-24T08:00:00Z' },
    ]);
    db.seed(
      'public',
      'messages',
      Array.from({ length: 8 }, () => ({
        user_id: TENANT,
        status: 'envoye',
        sent_at: '2026-09-24T09:00:00Z',
      }))
    );
    const { status, json } = await send(1);
    expect(status).toBe(429);
    expect(json.dailyLimit).toBe(8);
    expect(sends).toHaveLength(0);
  });

  it('sans warm-up : plafond normal (40)', async () => {
    db.seed('public', 'profiles', [{ id: TENANT, whatsapp_warmup_started_at: null }]);
    const { status, json } = await send(1);
    expect(status).toBe(200);
    expect(json.dailyLimit).toBe(40);
    expect(sends).toHaveLength(1);
  });
});

describe('budget de durée (Vercel coupe à 60 s)', () => {
  it('s’arrête avant d’être coupé et rend les destinataires non traités', async () => {
    db.seed('public', 'profiles', [{ id: TENANT, whatsapp_warmup_started_at: null }]);
    const { status, json } = await send(4);

    expect(status).toBe(200);
    expect(json.sent).toBe(2); // t=0 puis t=30 s ; le 3e finirait après 60 s
    expect(json.deferred.map((d: { tracking: string }) => d.tracking)).toEqual(['TRK2', 'TRK3']);
    // Les non traités ne sont PAS journalisés comme échecs (donc jamais « renvoyés »).
    expect(db.all('public', 'messages')).toHaveLength(2);
    expect(sends).toEqual(['213550000000', '213550000001']);
  });
});

describe('sélection « Renvoyer les échecs »', () => {
  const now = Date.parse('2026-09-24T10:00:00Z');
  const row = (o: Partial<MessageLogRow>): MessageLogRow => ({
    tracking_number: 'T1',
    customer_name: 'C',
    customer_whatsapp: '0550000001',
    message: 'm',
    status: 'echec',
    sent_at: '2026-09-24T09:00:00Z',
    ...o,
  });

  it('ignore les échecs de plus de 24 h (historique d’avril-juillet)', () => {
    expect(selectResendable([row({ sent_at: '2026-07-30T12:00:00Z' })], now)).toHaveLength(0);
  });

  it('ignore un échec déjà renvoyé avec succès (même numéro, même colis)', () => {
    const rows = [
      row({
        status: 'envoye',
        sent_at: '2026-09-24T09:30:00Z',
        customer_whatsapp: '+213550000001',
      }),
      row({}),
    ];
    expect(selectResendable(rows, now)).toHaveLength(0);
  });

  it('dédoublonne les échecs identiques', () => {
    expect(selectResendable([row({}), row({ sent_at: '2026-09-24T09:10:00Z' })], now)).toHaveLength(
      1
    );
  });

  it('garde un échec récent jamais renvoyé', () => {
    expect(selectResendable([row({})], now)).toHaveLength(1);
  });
});

async function sendList(list: unknown[]) {
  const { POST } = await import('@/app/api/whatsapp/send/route');
  const res = await POST(
    new NextRequest('https://app.test/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({ recipients: list }),
    })
  );
  return { status: res.status, json: await res.json() };
}

describe('anti-doublon et circuit du tenant (envoi manuel)', () => {
  it('même numéro + même colis deux fois dans la sélection → UN seul envoi', async () => {
    const r = recipients(1)[0];
    const { json } = await sendList([r, { ...r, whatsapp: '+213 550 000 000' }]);
    expect(sends).toHaveLength(1);
    expect(json.duplicates).toHaveLength(1);
  });

  it('déjà envoyé il y a 2 min (double clic / autre onglet) → rien renvoyé', async () => {
    const r = recipients(1)[0];
    db.seed('public', 'messages', [
      {
        user_id: TENANT,
        customer_whatsapp: r.whatsapp,
        tracking_number: r.tracking,
        status: 'envoye',
        sent_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      },
    ]);
    const { status, json } = await sendList([r]);
    expect(status).toBe(200);
    expect(sends).toHaveLength(0);
    expect(json.duplicates).toHaveLength(1);
  });

  it('même numéro, AUTRE colis → envoyé (message différent légitime)', async () => {
    const [a] = recipients(1);
    await sendList([a, { ...a, tracking: 'TRK-AUTRE' }]);
    expect(sends).toHaveLength(2);
  });

  it('circuit du tenant ouvert (file) → 503, aucun appel Evolution', async () => {
    db.seed('autotim', 'tenant_settings', [
      {
        tenant_id: TENANT,
        consecutive_send_failures: 5,
        circuit_open_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    ]);
    const { status, json } = await sendList(recipients(2));
    expect(status).toBe(503);
    expect(json.code).toBe('CIRCUIT_OPEN');
    expect(sends).toHaveLength(0);
  });
});
