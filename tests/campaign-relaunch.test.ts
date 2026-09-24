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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ state: 'open' }))
  );
  vi.spyOn(console, 'info').mockImplementation(() => {});
  db.seed('public', 'whatsapp_instances', [
    { user_id: TENANT, service_type: 'auto_confirmation', instance_name: 'inst', connected: true },
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

async function send() {
  const { POST } = await import('@/app/api/campaigns/[id]/send/route');
  const res = await POST(
    new NextRequest(`https://app.test/api/campaigns/${CAMPAIGN}/send`, { method: 'POST' }),
    { params: Promise.resolve({ id: CAMPAIGN }) }
  );
  return { status: res.status, json: await res.json() };
}

const pendingDispatches = () =>
  db.all('autotim', 'jobs').filter((j) => j.type === 'campaign.dispatch' && j.status === 'pending');

describe('renvoi d’une campagne terminée', () => {
  it('enfile réellement un nouveau dispatch (avant : no-op, campagne bloquée « en cours »)', async () => {
    seedFinishedCampaign(['0550000001', '0550000002']);
    const { status, json } = await send();
    expect(status).toBe(200);
    expect(json.message).toMatch(/pas encore reçu/);
    expect(pendingDispatches()).toHaveLength(1);
    expect(db.all('public', 'campaigns')[0].status).toBe('en_cours');
  });

  it('ne recontacte PAS les destinataires déjà servis', async () => {
    seedFinishedCampaign(['0550000001', '0550000002']);
    await send();
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
    await send();
    const [dispatch] = pendingDispatches();
    await handleCampaignDispatch({ ...dispatch, status: 'running' } as unknown as Job);
    const next = pendingDispatches().find((j) => j.payload.offset === 2);
    expect(next?.payload.run).toBe(dispatch.payload.run);
    expect(next?.idempotency_key).toBe(campaignDispatchKey(CAMPAIGN, 2, dispatch.payload.run));
  });

  it('double clic : un seul lancement', async () => {
    seedFinishedCampaign(['0550000001']);
    const [a, b] = await Promise.all([send(), send()]);
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
