// Questions ajoutées aux notifications « en livraison » et « livré » : aucune
// notification en plus, la réponse 1/2/3 est enregistrée pour le marchand.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import {
  markRequestHandled,
  openStatusPrompt,
  pendingClientRequests,
  promptKindForStatus,
  ratingStats,
  withPromptFooter,
} from '@/lib/inbox/status-prompts';
import { handlePromptReply } from '@/lib/inbox/confirm';

const fake = new FakeSupabase();
const svc = fake as any;
beforeEach(() => fake.reset());

describe('withPromptFooter', () => {
  it('« en livraison » et « livré » portent une question, les autres statuts non', () => {
    expect(promptKindForStatus('en_livraison')).toBe('delivery');
    expect(promptKindForStatus('livre')).toBe('rating');
    expect(promptKindForStatus('en_transit')).toBeNull();
    expect(withPromptFooter('en_livraison', 'Le livreur arrive')).toContain('*3* نبدّل العنوان');
    expect(withPromptFooter('livre', 'Livré')).toContain('ماعجبنيش');
    expect(withPromptFooter('echec', 'Échec')).toBe('Échec');
  });
});

describe('réponses du client', () => {
  it('jour de livraison : « 2 » = report à demain, visible par le marchand jusqu’à traitement', async () => {
    await openStatusPrompt(svc, 'T1', '0550123456', 'en_livraison', 'ZR-1');
    const r = await handlePromptReply(svc, 'T1', '213550123456', '2');
    expect(r).toMatchObject({ handled: true, kind: 'delivery', answer: '2' });
    expect(r.reply).toContain('غدوة');

    const pending = await pendingClientRequests(svc, 'T1');
    expect(pending).toHaveLength(1);
    expect(pending![0]).toMatchObject({ ref: 'ZR-1', answer: '2' });

    expect(await markRequestHandled(svc, 'T1', pending![0].id)).toBe(true);
    expect(await pendingClientRequests(svc, 'T1')).toEqual([]);
  });

  it('« 1 » (disponible) n’est pas une demande à traiter', async () => {
    await openStatusPrompt(svc, 'T1', '0550123456', 'en_livraison', 'ZR-1');
    await handlePromptReply(svc, 'T1', '213550123456', '1');
    expect(await pendingClientRequests(svc, 'T1')).toEqual([]);
  });

  it('avis après livraison → statistiques', async () => {
    for (const [phone, answer] of [
      ['0550000001', '1'],
      ['0550000002', '1'],
      ['0550000003', '3'],
    ]) {
      await openStatusPrompt(svc, 'T1', phone, 'livre', `ZR-${phone}`);
      await handlePromptReply(svc, 'T1', `213${phone.slice(1)}`, answer);
    }
    expect(await ratingStats(svc, 'T1')).toEqual({ total: 3, excellent: 2, correct: 0, bad: 1 });
    expect(await ratingStats(svc, 'T2')).toEqual({ total: 0, excellent: 0, correct: 0, bad: 0 });
  });

  it('isolation : un marchand ne marque pas la demande d’un autre', async () => {
    await openStatusPrompt(svc, 'T1', '0550123456', 'en_livraison', 'ZR-1');
    await handlePromptReply(svc, 'T1', '213550123456', '3');
    const [req] = (await pendingClientRequests(svc, 'T1'))!;
    expect(await markRequestHandled(svc, 'T2', req.id)).toBe(false);
    expect(await pendingClientRequests(svc, 'T2')).toEqual([]);
  });

  it('statut sans question ou numéro invalide → rien d’enregistré', async () => {
    await openStatusPrompt(svc, 'T1', '0550123456', 'en_transit', 'ZR-1');
    await openStatusPrompt(svc, 'T1', '12', 'livre', 'ZR-2');
    expect(fake.all('autotim', 'wa_prompts')).toEqual([]);
  });
});
