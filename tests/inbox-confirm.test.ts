// Confirmation WhatsApp des commandes du Sheet : message, lecture de la
// réponse, envoi sans doublon, isolation entre comptes.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeSupabase } from './helpers/fake-supabase';
import {
  buildConfirmMessage,
  expireUnanswered,
  handlePromptReply,
  parseAnswer,
  sendConfirmation,
  sendPendingConfirmations,
  type ConfirmOrder,
} from '@/lib/inbox/confirm';

const fake = new FakeSupabase();
const svc = fake as any;

const order: ConfirmOrder = {
  id: 'o1',
  customer_name: 'أمين',
  phone: '213550123456',
  wilaya: 'Oran',
  commune: 'Bir El Djir',
  product: 'Veste EMY',
  quantity: 2,
  price: 6400,
  delivery_type: 'stopdesk',
};

describe('buildConfirmMessage', () => {
  it('message par défaut : produit, quantité, prix, livraison, consigne de réponse', () => {
    const m = buildConfirmMessage(order);
    expect(m).toContain('أمين');
    expect(m).toContain('*Veste EMY* × 2');
    expect(m).toContain('6 400 دج');
    expect(m).toContain('للمكتب');
    expect(m).toContain('Oran · Bir El Djir');
    expect(m).toContain('*1*');
    expect(m).toContain('*2*');
  });

  it('modèle personnalisé du marchand', () => {
    expect(
      buildConfirmMessage(order, 'Salam {{client}}, {{produit}} à {{prix}} DA ? 1=oui 2=non')
    ).toBe('Salam أمين, Veste EMY à 6 400 DA ? 1=oui 2=non');
  });
});

describe('parseAnswer', () => {
  it('chiffres latins / arabes, avec ou sans emoji', () => {
    for (const s of ['1', ' 1 ', '١', '1 ✅', '*1*', '1.'])
      expect(parseAnswer(s, 'confirm'), s).toBe('1');
    for (const s of ['2', '٢', '2 ❌']) expect(parseAnswer(s, 'confirm'), s).toBe('2');
  });

  it('mots courants', () => {
    for (const s of ['نعم', 'ايه', 'واه', 'أكيد', 'oui', 'OK', 'wah', '✅', '👍'])
      expect(parseAnswer(s, 'confirm'), s).toBe('1');
    for (const s of ['لا', 'نلغي', 'non', 'annuler', '❌', 'la'])
      expect(parseAnswer(s, 'confirm'), s).toBe('2');
  });

  it('un message libre n’est pas une réponse (il continue vers le chatbot)', () => {
    for (const s of [
      'wach kayen l couleur noir ?',
      'لازم نبدل العنوان',
      '12',
      '0550123456',
      'لاباس عليك',
      '',
    ])
      expect(parseAnswer(s, 'confirm'), s).toBeNull();
  });
});

describe('envoi et réponse', () => {
  beforeEach(() => fake.reset());

  const seed = (o: Partial<Record<string, unknown>> = {}) =>
    fake.seed('autotim', 'inbox_orders', [
      {
        id: 'o1',
        tenant_id: 'T1',
        status: 'new',
        customer_name: 'أمين',
        phone: '213550123456',
        wilaya: 'Oran',
        commune: '',
        product: 'Veste EMY',
        quantity: 1,
        price: 3200,
        delivery_type: 'domicile',
        created_at: '2026-11-24T10:00:00Z',
        ...o,
      },
    ]);

  const deps = (send = vi.fn(async () => true)) => ({
    service: svc,
    tenantId: 'T1',
    send,
    logSent: vi.fn(async () => {}),
  });

  it('envoi → en confirmation, question ouverte, message journalisé', async () => {
    seed();
    const d = deps();
    expect(await sendConfirmation(d, 'o1')).toBe('sent');
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.logSent).toHaveBeenCalledTimes(1);
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('confirming');
    expect(fake.all('autotim', 'wa_prompts')).toMatchObject([
      { tenant_id: 'T1', phone: '213550123456', kind: 'confirm', ref: 'o1' },
    ]);
  });

  it('jamais deux envois pour la même commande (deux onglets)', async () => {
    seed();
    const d = deps();
    await sendConfirmation(d, 'o1');
    expect(await sendConfirmation(d, 'o1')).toBe('not_found');
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('échec d’envoi → la commande redevient « nouvelle », rien de journalisé', async () => {
    seed();
    const d = deps(vi.fn(async () => false));
    expect(await sendConfirmation(d, 'o1')).toBe('failed');
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('new');
    expect(d.logSent).not.toHaveBeenCalled();
    expect(fake.all('autotim', 'wa_prompts')).toEqual([]);
  });

  it('réponse « 1 » → confirmée + accusé ; une 2e réponse ne change plus rien', async () => {
    seed();
    await sendConfirmation(deps(), 'o1');
    const r = await handlePromptReply(svc, 'T1', '213550123456', '1');
    expect(r).toMatchObject({ handled: true, kind: 'confirm', answer: '1' });
    expect(r.reply).toContain('تأكدت');
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('confirmed');

    // Plus de question ouverte : « 2 » n'est plus une réponse
    const again = await handlePromptReply(svc, 'T1', '213550123456', '2');
    expect(again.handled).toBe(false);
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('confirmed');
  });

  it('réponse « 2 » → annulée', async () => {
    seed();
    await sendConfirmation(deps(), 'o1');
    await handlePromptReply(svc, 'T1', '213550123456', 'لا');
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('cancelled');
  });

  it('message libre → non traité (le chatbot répond), la question reste ouverte', async () => {
    seed();
    await sendConfirmation(deps(), 'o1');
    expect((await handlePromptReply(svc, 'T1', '213550123456', 'كاين الأسود ؟')).handled).toBe(
      false
    );
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('confirming');
  });

  it('isolation : la réponse d’un numéro ne touche jamais la commande d’un autre compte', async () => {
    seed();
    await sendConfirmation(deps(), 'o1');
    expect((await handlePromptReply(svc, 'T2', '213550123456', '1')).handled).toBe(false);
    expect((await handlePromptReply(svc, 'T1', '213661000000', '1')).handled).toBe(false);
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('confirming');
  });

  it('sans réponse au bout de 24 h → « sans réponse », une réponse tardive confirme quand même', async () => {
    seed();
    const t0 = Date.parse('2026-11-24T10:00:00Z');
    await sendConfirmation({ ...deps(), now: t0 }, 'o1');
    await expireUnanswered(svc, 'T1', t0 + 25 * 3600 * 1000);
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('no_answer');
    await handlePromptReply(svc, 'T1', '213550123456', '1', t0 + 26 * 3600 * 1000);
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('confirmed');
  });

  it('envoi automatique : budget respecté, les plus anciennes d’abord', async () => {
    fake.seed('autotim', 'inbox_orders', [
      {
        id: 'a',
        tenant_id: 'T1',
        status: 'new',
        phone: '213550000001',
        created_at: '2026-11-24T09:00:00Z',
      },
      {
        id: 'b',
        tenant_id: 'T1',
        status: 'new',
        phone: '213550000002',
        created_at: '2026-11-24T08:00:00Z',
      },
      {
        id: 'c',
        tenant_id: 'T1',
        status: 'new',
        phone: '213550000003',
        created_at: '2026-11-24T10:00:00Z',
      },
      {
        id: 'x',
        tenant_id: 'T2',
        status: 'new',
        phone: '213550000009',
        created_at: '2026-11-24T07:00:00Z',
      },
    ]);
    const d = deps();
    expect(await sendPendingConfirmations(d, 2)).toBe(2);
    const st = Object.fromEntries(fake.all('autotim', 'inbox_orders').map((o) => [o.id, o.status]));
    expect(st).toEqual({ a: 'confirming', b: 'confirming', c: 'new', x: 'new' });
    expect(await sendPendingConfirmations(d, 0)).toBe(0);
  });
});
