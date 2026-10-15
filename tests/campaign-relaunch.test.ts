// « Renvoyer » une campagne terminée.
//
// L'index jobs_idempotency_uniq n'est pas partiel : une clé reste prise pour
// toujours. L'ancien code ré-enfilait `campdisp:<id>:0` → no-op silencieux,
// la campagne passait « en cours » et n'en sortait jamais.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
const TENANT = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = 'c0000000-0000-4000-8000-000000000001';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => db,
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: TENANT } } }) },
  }),
}));
vi.mock('@/lib/user-creds', () => ({
  resolveEvolutionCreds: async () => ({ url: 'https://evolution.test', key: 'global-key' }),
}));

import { handleCampaignDispatch } from '@/lib/queue/handlers/campaign-dispatch';
import { campaignDispatchKey, campaignRecipientKey } from '@/lib/queue/idempotency';
import type { Job } from '@/lib/queue/types';

beforeEach(() => {
  db = new FakeSupabase();
  // `.like()` absent du FakeSupabase partagé (modifié par 14 branches ouvertes) :
  // ajouté ICI seulement, traduit en filtre `in` sur les valeurs correspondantes.
  type LikeBuilder = {
    db: { rows: (t: string) => Record<string, unknown>[] };
    table: string;
    filters: unknown[];
  };
  const proto = Object.getPrototypeOf(db.from('campaigns')) as Record<string, unknown>;
  if (!proto.like)
    proto.like = function (this: LikeBuilder, col: string, pattern: string) {
      const esc = (x: string) => x.replace(/[^\w:-]/g, (c) => `\\${c}`);
      const re = new RegExp(`^${pattern.split('%').map(esc).join('.*')}$`);
      const vals = this.db
        .rows(this.table)
        .map((r) => r[col])
        .filter((v) => typeof v === 'string' && re.test(v));
      this.filters.push({ kind: 'in', col, val: vals });
      return this;
    };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ state: 'open' }))
  );
  vi.spyOn(console, 'info').mockImplementation(() => {});
  db.seed('public', 'whatsapp_instances', [
    { user_id: TENANT, service_type: 'auto_confirmation', instance_name: 'zrex_111111111111_auto', connected: true },
  ]);
  db.seed('public', 'profiles', [{ id: TENANT, whatsapp_warmup_started_at: null }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function seedFinishedCampaign(phones: string[]) {
  db.seed('public', 'campaigns', [
    {
      id: CAMPAIGN,
      user_id: TENANT,
      status: 'termine',
      message_template: 'Salam {{client}}',
      audience_phones: phones,
    },
  ]);
  // Traces du premier envoi : dispatch initial + un destinataire servi.
  db.seed('autotim', 'jobs', [
    {
      tenant_id: TENANT,
      type: 'campaign.dispatch',
      status: 'done',
      attempts: 1,
      max_attempts: 3,
      payload: { campaign_id: CAMPAIGN, offset: 0 },
      idempotency_key: campaignDispatchKey(CAMPAIGN, 0),
    },
    {
      tenant_id: TENANT,
      type: 'whatsapp.send',
      status: 'done',
      attempts: 1,
      max_attempts: 1,
      payload: { campaign_id: CAMPAIGN, phone: phones[0], message: 'x' },
      idempotency_key: campaignRecipientKey(CAMPAIGN, phones[0]),
    },
  ]);
}

async function send(body?: unknown) {
  const { POST } = await import('@/app/api/campaigns/[id]/send/route');
  const res = await POST(
    new NextRequest(`https://app.test/api/campaigns/${CAMPAIGN}/send`, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id: CAMPAIGN }) }
  );
  return { status: res.status, json: await res.json() };
}

/** Renvoi confirmé avec le chiffre exact de l'audience (garde-fou). */
const confirmed = (audience: number) => ({ confirm_relaunch: true, expected_audience: audience });

const pendingDispatches = () =>
  db.all('autotim', 'jobs').filter((j) => j.type === 'campaign.dispatch' && j.status === 'pending');

describe('renvoi d’une campagne terminée', () => {
  it('enfile réellement un nouveau dispatch (avant : no-op, campagne bloquée « en cours »)', async () => {
    seedFinishedCampaign(['0550000001', '0550000002']);
    const { status, json } = await send(confirmed(2));
    expect(status).toBe(200);
    expect(json.message).toMatch(/pas encore reçu/);
    expect(pendingDispatches()).toHaveLength(1);
    expect(db.all('public', 'campaigns')[0].status).toBe('en_cours');
  });

  it('ne recontacte PAS les destinataires déjà servis', async () => {
    seedFinishedCampaign(['0550000001', '0550000002']);
    await send(confirmed(2));
    const [dispatch] = pendingDispatches();
    const job = { ...dispatch, status: 'running', attempts: 1 } as unknown as Job;
    await handleCampaignDispatch(job);

    const sends = db
      .all('autotim', 'jobs')
      .filter((j) => j.type === 'whatsapp.send' && j.status === 'pending');
    expect(sends.map((j) => j.payload.phone)).toEqual(['0550000002']);
  });

  it('le lot suivant garde le même lancement', async () => {
    seedFinishedCampaign(['0550000001', '0550000002']);
    await send(confirmed(2));
    const [dispatch] = pendingDispatches();
    await handleCampaignDispatch({ ...dispatch, status: 'running' } as unknown as Job);
    const next = pendingDispatches().find((j) => j.payload.offset === 2);
    expect(next?.payload.run).toBe(dispatch.payload.run);
    expect(next?.idempotency_key).toBe(campaignDispatchKey(CAMPAIGN, 2, dispatch.payload.run));
  });

  it('double clic : un seul lancement', async () => {
    seedFinishedCampaign(['0550000001']);
    const [a, b] = await Promise.all([send(confirmed(1)), send(confirmed(1))]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(pendingDispatches()).toHaveLength(1);
  });
});

describe('premier lancement — inchangé', () => {
  it('brouillon → clé historique campdisp:<id>:0', async () => {
    db.seed('public', 'campaigns', [
      { id: CAMPAIGN, user_id: TENANT, status: 'brouillon', message_template: 'x' },
    ]);
    await send();
    expect(pendingDispatches()[0].idempotency_key).toBe(`campdisp:${CAMPAIGN}:0`);
  });
});

describe('garde-fou : renvoi explicite', () => {
  it('sans confirmation → 409 + aperçu, RIEN enfilé, statut inchangé', async () => {
    seedFinishedCampaign(['0550000001', '0550000002', '0550000003']);
    const { status, json } = await send();
    expect(status).toBe(409);
    expect(json.code).toBe('RELAUNCH_CONFIRMATION_REQUIRED');
    expect(json.preview).toEqual({
      audience: 3,
      already_served: 1,
      max_new_recipients: 2,
      dynamic_audience: false,
    });
    expect(pendingDispatches()).toHaveLength(0);
    expect(db.all('public', 'campaigns')[0].status).toBe('termine');
  });

  it('chiffre périmé (audience changée depuis l’aperçu) → 409, rien enfilé', async () => {
    seedFinishedCampaign(['0550000001', '0550000002']);
    const { status } = await send(confirmed(5));
    expect(status).toBe(409);
    expect(pendingDispatches()).toHaveLength(0);
  });

  it('confirm_relaunch non booléen → refus', async () => {
    seedFinishedCampaign(['0550000001', '0550000002']);
    expect((await send({ confirm_relaunch: 'yes', expected_audience: 2 })).status).toBe(409);
  });

  it('audience dynamique : compte les commandes ACTUELLES du tenant seulement', async () => {
    db.seed('public', 'campaigns', [
      {
        id: CAMPAIGN,
        user_id: TENANT,
        status: 'termine',
        message_template: 'x',
        audience_phones: null,
      },
    ]);
    db.seed('public', 'orders', [
      { user_id: TENANT, customer_whatsapp: '0550000001' },
      { user_id: TENANT, customer_whatsapp: '0550000002' },
      { user_id: TENANT, customer_whatsapp: '' },
      { user_id: 'autre-tenant', customer_whatsapp: '0550000009' },
    ]);
    const { status, json } = await send();
    expect(status).toBe(409);
    expect(json.preview).toMatchObject({ audience: 2, already_served: 0, dynamic_audience: true });
  });

  it('premier lancement (brouillon) : aucune confirmation demandée', async () => {
    db.seed('public', 'campaigns', [
      {
        id: CAMPAIGN,
        user_id: TENANT,
        status: 'brouillon',
        message_template: 'x',
        audience_phones: ['0550000001'],
      },
    ]);
    expect((await send()).status).toBe(200);
  });
});
