// Historique ZR du client et doublons, affichés sur les commandes à confirmer.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import { customerHistories, pendingCountByPhone, phoneVariants } from '@/lib/inbox/history';
import { canMoveTo } from '@/lib/inbox/store';

const fake = new FakeSupabase();
const svc = fake as any;
beforeEach(() => fake.reset());

describe('phoneVariants', () => {
  it('toutes les écritures d’un numéro algérien', () => {
    expect(phoneVariants('213550123456')).toEqual([
      '213550123456',
      '+213550123456',
      '0550123456',
      '550123456',
    ]);
  });
});

describe('customerHistories', () => {
  const o = (phone: string, delivery_status: string, user_id = 'T1') => ({
    user_id,
    customer_whatsapp: phone,
    delivery_status,
    deleted_at: null,
  });

  it('regroupe les écritures du même numéro, score refus / livrés', async () => {
    fake.seed('public', 'orders', [
      o('0550123456', 'echec'),
      o('+213550123456', 'retourne'),
      o('213550123456', 'en_livraison'),
      o('0661000000', 'livre'),
      o('0661000000', 'livre'),
      o('0550123456', 'livre', 'T2'), // autre marchand : ignoré
    ]);
    const h = await customerHistories(svc, 'T1', ['213550123456', '213661000000', '213770000000']);
    expect(h.get('213550123456')).toEqual({ livre: 0, refus: 2, level: 'risque' });
    expect(h.get('213661000000')).toEqual({ livre: 2, refus: 0, level: 'fidele' });
    expect(h.has('213770000000')).toBe(false);
  });

  it('base indisponible → aucun historique, aucune erreur', async () => {
    fake.failNext('public', 'orders', 'select', { code: '57014' });
    expect((await customerHistories(svc, 'T1', ['213550123456'])).size).toBe(0);
  });
});

describe('pendingCountByPhone / transitions', () => {
  it('doublons : seules les commandes en attente comptent', () => {
    const m = pendingCountByPhone([
      { phone: '213550123456', status: 'new' },
      { phone: '0550123456', status: 'confirmed' },
      { phone: '213550123456', status: 'cancelled' },
      { phone: '213550123456', status: 'sent' },
    ]);
    expect(m.get('213550123456')).toBe(2);
  });

  it('« pas de réponse » possible après un appel (nouvelle) ou une demande WhatsApp', () => {
    expect(canMoveTo('new', 'no_answer')).toBe(true);
    expect(canMoveTo('confirming', 'no_answer')).toBe(true);
    expect(canMoveTo('confirmed', 'no_answer')).toBe(false);
  });
});
