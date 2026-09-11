// Phase 1 — Intégration du handler `campaign.dispatch`.
//
// Le handler RÉEL tourne contre un Supabase en mémoire. Il n'envoie rien : il
// ENFILE des whatsapp.send par lots de 25 et se ré-enfile avec un curseur.
// Aucun réseau, aucun WhatsApp, aucune campagne réelle.
//
// Verrouillé ici :
//   - lots de BATCH_SIZE = 25, curseur campdisp:<campagne>:<offset>
//   - un destinataire = un job (camp:<campagne>:<phone>), jamais deux
//   - rejouer un lot déjà traité n'enfile rien (idempotence)
//   - campagne arrêtée → done sans enfiler
//   - retry : 3 tentatives puis DLQ
//   - isolation : campagne d'un autre tenant introuvable ; audience du tenant seul

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeSupabase } from '../helpers/fake-supabase';
import { MAX_ATTEMPTS, type Job } from '@/lib/queue/types';
import { campaignRecipientKey, campaignDispatchKey } from '@/lib/queue/idempotency';

let fake: FakeSupabase;

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fake,
}));

import { handleCampaignDispatch } from '@/lib/queue/handlers/campaign-dispatch';
import { enqueue } from '@/lib/queue/repository';
import { runTick } from '@/lib/queue/runner';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = 'c0000000-0000-4000-8000-000000000001';

function makeJob(offset = 0, over: Partial<Job> = {}): Job {
  return {
    id: `disp-${offset}`,
    tenant_id: TENANT_A,
    type: 'campaign.dispatch',
    payload: { campaign_id: CAMPAIGN, offset },
    status: 'running',
    run_after: new Date().toISOString(),
    attempts: 1,
    max_attempts: 3,
    locked_at: new Date().toISOString(),
    locked_by: 'w',
    last_error: null,
    idempotency_key: campaignDispatchKey(CAMPAIGN, offset),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function seedCampaign(over: Record<string, any> = {}, tenant = TENANT_A) {
  return fake.seed('public', 'campaigns', [
    {
      id: CAMPAIGN,
      user_id: tenant,
      status: 'en_cours',
      message_template: 'Salam {{client}}, colis {{tracking}} → {{wilaya}} ({{cod}} DA)',
      audience_status: 'livre',
      audience_phones: null,
      media_url: null,
      ...over,
    },
  ])[0];
}

function seedOrders(n: number, tenant = TENANT_A, status = 'livre') {
  return fake.seed(
    'public',
    'orders',
    Array.from({ length: n }, (_, i) => ({
      user_id: tenant,
      tracking_number: `ZR-${tenant.slice(0, 1)}-${i}`,
      customer_name: `Client ${i}`,
      customer_whatsapp: `05561726${String(i).padStart(2, '0')}`,
      wilaya: 'Alger',
      product_name: 'Produit',
      cod: 1000 + i,
      delivery_status: status,
      created_at: new Date(Date.now() - (n - i) * 1000).toISOString(),
      last_update: new Date().toISOString(),
    }))
  );
}

const sendJobs = () => fake.all('autotim', 'jobs').filter((j) => j.type === 'whatsapp.send');
const dispatchJobs = () =>
  fake.all('autotim', 'jobs').filter((j) => j.type === 'campaign.dispatch');

beforeEach(() => {
  fake = new FakeSupabase();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      throw new Error(`appel réseau interdit en test : ${String(input)}`);
    })
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Lots et curseur', () => {
  it('30 destinataires → 25 + 5 + clôture, 30 jobs uniques, campagne `termine`', async () => {
    seedCampaign();
    seedOrders(30);

    // Lot 1
    expect(await handleCampaignDispatch(makeJob(0))).toEqual({ outcome: 'done' });
    expect(sendJobs()).toHaveLength(25);
    expect(dispatchJobs()).toHaveLength(1);
    expect(dispatchJobs()[0]).toMatchObject({
      tenant_id: TENANT_A,
      payload: { campaign_id: CAMPAIGN, offset: 25 },
      idempotency_key: campaignDispatchKey(CAMPAIGN, 25),
      max_attempts: MAX_ATTEMPTS['campaign.dispatch'],
    });

    // Lot 2
    expect(await handleCampaignDispatch(makeJob(25))).toEqual({ outcome: 'done' });
    expect(sendJobs()).toHaveLength(30);
    expect(
      dispatchJobs()
        .map((d) => d.payload.offset)
        .sort()
    ).toEqual([25, 30]);

    // Lot 3 : audience vide → clôture
    expect(await handleCampaignDispatch(makeJob(30))).toEqual({ outcome: 'done' });
    expect(sendJobs()).toHaveLength(30);
    expect(dispatchJobs()).toHaveLength(2); // pas de ré-enfilement
    expect(fake.all('public', 'campaigns')[0].status).toBe('termine');

    // Chaque destinataire une seule fois.
    const keys = sendJobs().map((j) => j.idempotency_key);
    expect(new Set(keys).size).toBe(30);
    expect(keys).toContain(campaignRecipientKey(CAMPAIGN, '0556172600'));
  });

  it('le message est interpolé et le payload complet', async () => {
    seedCampaign();
    seedOrders(1);
    await handleCampaignDispatch(makeJob(0));
    const j = sendJobs()[0];
    expect(j.payload).toMatchObject({
      campaign_id: CAMPAIGN,
      phone: '0556172600',
      tracking_number: 'ZR-1-0',
      customer_name: 'Client 0',
    });
    expect(j.payload.message).toBe('Salam Client 0, colis ZR-1-0 → Alger (1000 DA)');
    expect(j.payload.media_url).toBeUndefined();
    expect(j.max_attempts).toBe(1); // whatsapp.send : jamais rejoué
  });

  it('media_url de la campagne est propagée aux envois', async () => {
    seedCampaign({ media_url: 'https://cdn.test/promo.jpg' });
    seedOrders(2);
    await handleCampaignDispatch(makeJob(0));
    expect(sendJobs().every((j) => j.payload.media_url === 'https://cdn.test/promo.jpg')).toBe(
      true
    );
  });

  it('les envois sont espacés (≥ 10 s puis 20-60 s), le lot suivant après le dernier envoi', async () => {
    seedCampaign();
    seedOrders(3);
    const t0 = Date.now();
    await handleCampaignDispatch(makeJob(0));
    const times = sendJobs()
      .map((j) => new Date(j.run_after).getTime() - t0)
      .sort((a, b) => a - b);
    expect(times[0]).toBeGreaterThanOrEqual(9_000);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(19_000);
      expect(times[i] - times[i - 1]).toBeLessThanOrEqual(61_000);
    }
    const next = new Date(dispatchJobs()[0].run_after).getTime() - t0;
    expect(next).toBeGreaterThan(times[times.length - 1]);
  });

  it('audience personnalisée : enrichie depuis orders, numéros inconnus conservés', async () => {
    seedCampaign({ audience_status: null, audience_phones: ['0556172600', '0777000000'] });
    seedOrders(1);
    await handleCampaignDispatch(makeJob(0));
    const jobs = sendJobs();
    expect(jobs).toHaveLength(2);
    const known = jobs.find((j) => j.payload.phone === '0556172600')!;
    const unknown = jobs.find((j) => j.payload.phone === '0777000000')!;
    expect(known.payload.customer_name).toBe('Client 0');
    expect(unknown.payload.customer_name).toBe('');
    expect(unknown.payload.message).toBe('Salam , colis  →  ( DA)');
  });

  it('filtre par statut : seules les commandes `livre` du tenant', async () => {
    seedCampaign({ audience_status: 'livre' });
    seedOrders(3, TENANT_A, 'livre');
    seedOrders(4, TENANT_A, 'en_transit');
    await handleCampaignDispatch(makeJob(0));
    expect(sendJobs()).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Idempotence', () => {
  it('rejouer le lot 0 n’enfile RIEN de nouveau (destinataires et curseur)', async () => {
    seedCampaign();
    seedOrders(10);
    await handleCampaignDispatch(makeJob(0));
    const before = fake
      .all('autotim', 'jobs')
      .map((j) => j.id)
      .sort();

    // Second déclenchement du même lot (double clic, double scheduler…).
    expect(await handleCampaignDispatch(makeJob(0, { id: 'disp-0-bis' }))).toEqual({
      outcome: 'done',
    });

    const after = fake
      .all('autotim', 'jobs')
      .map((j) => j.id)
      .sort();
    expect(after).toEqual(before);
    expect(sendJobs()).toHaveLength(10);
    expect(dispatchJobs()).toHaveLength(1);
  });

  it('un numéro présent deux fois dans l’audience → un seul job', async () => {
    seedCampaign({ audience_status: null, audience_phones: ['0556172600', '0556172600'] });
    await handleCampaignDispatch(makeJob(0));
    expect(sendJobs()).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Arrêt et erreurs', () => {
  it('campagne `annule` → done, rien enfilé', async () => {
    seedCampaign({ status: 'annule' });
    seedOrders(5);
    expect(await handleCampaignDispatch(makeJob(0))).toEqual({ outcome: 'done' });
    expect(fake.all('autotim', 'jobs')).toHaveLength(0);
  });

  it('campagne `termine` → done, rien enfilé', async () => {
    seedCampaign({ status: 'termine' });
    seedOrders(5);
    await handleCampaignDispatch(makeJob(0));
    expect(fake.all('autotim', 'jobs')).toHaveLength(0);
  });

  it('campaign_id manquant → failed', async () => {
    const r = await handleCampaignDispatch(makeJob(0, { payload: {} }));
    expect(r).toEqual({ outcome: 'failed', error: 'campaign_id manquant' });
  });

  it('erreur de lecture campagne : 3 tentatives (MAX_ATTEMPTS) puis DLQ', async () => {
    const db = fake as any;
    await enqueue(db, {
      tenantId: TENANT_A,
      type: 'campaign.dispatch',
      payload: { campaign_id: CAMPAIGN, offset: 0 },
      idempotencyKey: campaignDispatchKey(CAMPAIGN, 0),
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      fake.failNext('public', 'campaigns', 'select', {
        code: '57014',
        message: 'statement timeout',
      });
      fake.all('autotim', 'jobs')[0].run_after = new Date(Date.now() - 1000).toISOString();
      const stats = await runTick({ 'campaign.dispatch': handleCampaignDispatch }, `t${attempt}`);
      const j = fake.all('autotim', 'jobs')[0];
      expect(j.attempts).toBe(attempt);
      expect(j.last_error).toContain('statement timeout');
      if (attempt < 3) {
        expect(stats).toMatchObject({ failed: 1, dead: 0 });
        expect(j.status).toBe('pending');
      } else {
        expect(stats).toMatchObject({ failed: 0, dead: 1 });
        expect(j.status).toBe('dead');
      }
    }
    expect(sendJobs()).toHaveLength(0); // jamais rien enfilé pendant les échecs
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Isolation tenant', () => {
  it('la campagne d’un autre tenant est introuvable → failed, rien enfilé', async () => {
    seedCampaign({}, TENANT_B);
    seedOrders(5, TENANT_B);
    const r = await handleCampaignDispatch(makeJob(0, { tenant_id: TENANT_A }));
    expect(r).toEqual({ outcome: 'failed', error: 'campagne introuvable pour ce tenant' });
    expect(fake.all('autotim', 'jobs')).toHaveLength(0);
    expect(fake.all('public', 'campaigns')[0].status).toBe('en_cours'); // intacte
  });

  it('l’audience ne contient que les commandes du tenant, même avec le même statut', async () => {
    seedCampaign();
    seedOrders(2, TENANT_A);
    seedOrders(40, TENANT_B);
    await handleCampaignDispatch(makeJob(0));
    const jobs = sendJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.tenant_id === TENANT_A)).toBe(true);
    expect(jobs.every((j) => String(j.payload.tracking_number).startsWith('ZR-1-'))).toBe(true);
  });

  it('toutes les écritures portent le tenant du job', async () => {
    seedCampaign();
    seedOrders(3);
    await handleCampaignDispatch(makeJob(0));
    expect(fake.writes.length).toBeGreaterThan(0);
    for (const w of fake.writes) {
      for (const row of w.rows) {
        const owner = row.user_id ?? row.tenant_id;
        expect(owner).toBe(TENANT_A);
      }
    }
  });
});
