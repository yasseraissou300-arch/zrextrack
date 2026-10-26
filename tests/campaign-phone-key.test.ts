// Campagnes — un client = un numéro, quel que soit son format d'écriture.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';

let db: FakeSupabase;
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db }));

import { handleCampaignDispatch } from '@/lib/queue/handlers/campaign-dispatch';
import { campaignRecipientKey, legacyCampaignRecipientKey } from '@/lib/queue/idempotency';
import type { Job } from '@/lib/queue/types';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = 'c0000000-0000-4000-8000-000000000001';

beforeEach(() => {
  db = new FakeSupabase();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

function seedCampaign(phones: string[]) {
  db.seed('public', 'campaigns', [
    {
      id: CAMPAIGN,
      user_id: TENANT,
      status: 'en_cours',
      message_template: 'Salam {{client}}',
      audience_phones: phones,
    },
  ]);
}

const job = (payload: Record<string, unknown> = {}) =>
  ({
    id: 'disp',
    tenant_id: TENANT,
    type: 'campaign.dispatch',
    payload: { campaign_id: CAMPAIGN, offset: 0, ...payload },
    status: 'running',
    attempts: 1,
    max_attempts: 3,
  }) as unknown as Job;

const sendJobs = () => db.all('autotim', 'jobs').filter((j) => j.type === 'whatsapp.send');

describe('clé destinataire normalisée', () => {
  it('« 0550… », « +213 550… » et « 00213550… » → UN seul envoi', async () => {
    seedCampaign(['0550000001', '+213 550 000 001', '00213550000001']);
    await handleCampaignDispatch(job());
    expect(sendJobs()).toHaveLength(1);
    expect(sendJobs()[0].idempotency_key).toBe(`camp:${CAMPAIGN}:213550000001`);
  });

  it('des numéros différents restent distincts', async () => {
    seedCampaign(['0550000001', '0550000002']);
    await handleCampaignDispatch(job());
    expect(sendJobs()).toHaveLength(2);
  });

  it('la clé est identique quel que soit le format', () => {
    expect(campaignRecipientKey('c', '0550000001')).toBe(
      campaignRecipientKey('c', '+213550000001')
    );
  });
});

describe('compatibilité avec les jobs créés avant la normalisation', () => {
  it('renvoi : un destinataire servi sous l’ANCIENNE clé brute n’est pas recontacté', async () => {
    seedCampaign(['0550000001', '0550000002']);
    db.seed('autotim', 'jobs', [
      {
        tenant_id: TENANT,
        type: 'whatsapp.send',
        status: 'done',
        attempts: 1,
        max_attempts: 1,
        payload: { phone: '0550000001' },
        idempotency_key: legacyCampaignRecipientKey(CAMPAIGN, '0550000001'),
      },
    ]);
    await handleCampaignDispatch(job({ run: 'r1' }));
    const phones = sendJobs()
      .filter((j) => j.status === 'pending')
      .map((j) => j.payload.phone);
    expect(phones).toEqual(['0550000002']);
  });
});
