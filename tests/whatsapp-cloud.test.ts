// WhatsApp OFFICIEL (Meta Cloud API) : configuration, heures calmes, modèles
// avec boutons, signature et lecture du webhook, réponse à une question.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { FakeSupabase } from './helpers/fake-supabase';

const T1 = '11111111-1111-4111-8111-111111111111';
const fake = new FakeSupabase();
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fake,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

const cloud = await import('@/lib/whatsapp/cloud');
const route = await import('@/app/api/whatsapp/cloud/webhook/route');
const { openPrompt } = await import('@/lib/inbox/confirm');

const sign = (raw: string, secret = 'app-secret') =>
  `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

const ENV = {
  WHATSAPP_CLOUD_TOKEN: 'tok',
  WHATSAPP_CLOUD_PHONE_ID: '1234567890',
  WHATSAPP_CLOUD_APP_SECRET: 'app-secret',
  WHATSAPP_CLOUD_VERIFY_TOKEN: 'verif',
  WHATSAPP_CLOUD_TENANTS: `${T1}, pas-un-uuid`,
} as unknown as NodeJS.ProcessEnv;

describe('configuration', () => {
  it('absente ou incomplète → désactivée', () => {
    expect(cloud.cloudConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(cloud.cloudConfig({ WHATSAPP_CLOUD_TOKEN: 'x' } as any)).toBeNull();
  });

  it('comptes autorisés (UUID valides seulement), plafond par défaut 250', () => {
    const c = cloud.cloudConfig(ENV)!;
    expect([...c.tenants]).toEqual([T1]);
    expect(c.dailyLimit).toBe(250);
    expect(c.lang).toBe('ar');
    expect(cloud.isCloudTenant(T1, ENV)).toBe(true);
    expect(cloud.isCloudTenant('22222222-2222-4222-8222-222222222222', ENV)).toBe(false);
  });
});

describe('heures calmes (21:00 → 08:00, Alger = UTC+1)', () => {
  const on = {} as NodeJS.ProcessEnv;
  it('nuit = pas d’envoi automatique, journée = envoi', () => {
    expect(cloud.isQuietHours(new Date('2026-11-28T20:00:00Z'), on)).toBe(true); // 21:00
    expect(cloud.isQuietHours(new Date('2026-11-28T06:59:00Z'), on)).toBe(true); // 07:59
    expect(cloud.isQuietHours(new Date('2026-11-28T07:00:00Z'), on)).toBe(false); // 08:00
    expect(cloud.isQuietHours(new Date('2026-11-28T19:59:00Z'), on)).toBe(false); // 20:59
  });

  it('report au prochain 08:00 d’Alger', () => {
    expect(cloud.nextMorning(new Date('2026-11-28T21:30:00Z')).toISOString()).toBe(
      '2026-11-29T07:00:00.000Z'
    );
    expect(cloud.nextMorning(new Date('2026-11-28T05:00:00Z')).toISOString()).toBe(
      '2026-11-28T07:00:00.000Z'
    );
  });

  it('interrupteur « off » réservé aux tests', () => {
    expect(
      cloud.isQuietHours(new Date('2026-11-28T23:00:00Z'), { WHATSAPP_QUIET_HOURS: 'off' } as any)
    ).toBe(false);
  });
});

describe('modèles', () => {
  it('confirmation : 5 variables + 2 boutons (charges « 1 » et « 2 »)', () => {
    const p = cloud.templatePayload(
      '213550123456',
      'confirm',
      { client: 'Amine', produit: 'Veste\nEMY', prix: 6400, livraison: 'للدار', wilaya: 'Oran' },
      'ar'
    ) as any;
    expect(p.template.name).toBe('autotim_confirmation');
    expect(p.template.language).toEqual({ code: 'ar' });
    expect(p.template.components[0].parameters.map((x: any) => x.text)).toEqual([
      'Amine',
      'Veste EMY',
      '6 400',
      'للدار',
      'Oran',
    ]);
    expect(p.template.components.slice(1).map((c: any) => c.parameters[0].payload)).toEqual([
      '1',
      '2',
    ]);
  });

  it('jour de livraison et avis : 3 boutons ; échec : aucun', () => {
    const n = (k: any) =>
      (cloud.templatePayload('1', k, { client: 'A', produit: 'B' }, 'ar') as any).template
        .components.length - 1;
    expect(n('en_livraison')).toBe(3);
    expect(n('livre')).toBe(3);
    expect(n('echec')).toBe(0);
  });

  it('paramètre vide → « — » (Meta refuse un paramètre vide)', () => {
    expect(cloud.cleanParam('')).toBe('—');
    expect(cloud.cleanParam('a\tb\n\nc')).toBe('a b c');
  });
});

describe('webhook entrant', () => {
  it('signature', () => {
    expect(cloud.validSignature('{"a":1}', sign('{"a":1}'), 'app-secret')).toBe(true);
    expect(cloud.validSignature('{"a":1}', sign('{"a":2}'), 'app-secret')).toBe(false);
    expect(cloud.validSignature('{"a":1}', null, 'app-secret')).toBe(false);
    expect(cloud.validSignature('{"a":1}', sign('{"a":1}'), '')).toBe(false);
  });

  it('bouton de modèle, bouton interactif, texte ; statuts de remise ignorés', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                messages: [
                  {
                    id: 'm1',
                    from: '213550123456',
                    type: 'button',
                    button: { payload: '1', text: 'نأكّد' },
                  },
                  {
                    id: 'm2',
                    from: '213550000000',
                    type: 'interactive',
                    interactive: { button_reply: { id: '2' } },
                  },
                  { id: 'm3', from: '213661000000', type: 'text', text: { body: 'salam' } },
                  { id: 'm4', from: '213661000000', type: 'image', image: {} },
                ],
                statuses: [{ id: 's1', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    };
    expect(cloud.inboundMessages(body).map((m) => [m.id, m.text])).toEqual([
      ['m1', '1'],
      ['m2', '2'],
      ['m3', 'salam'],
    ]);
  });
});

describe('route /api/whatsapp/cloud/webhook', () => {
  beforeEach(() => {
    fake.reset();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, String(v));
  });

  it('GET : validation Meta avec le bon jeton seulement', async () => {
    const ok = await route.GET(
      new NextRequest(
        'https://x.test/api/whatsapp/cloud/webhook?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=4242'
      )
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('4242');
    const bad = await route.GET(
      new NextRequest(
        'https://x.test/api/whatsapp/cloud/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=1'
      )
    );
    expect(bad.status).toBe(403);
  });

  it('POST non signé → 401 ; bouton « نأكّد » → commande confirmée + accusé', async () => {
    fake.seed('autotim', 'inbox_orders', [
      { id: 'o1', tenant_id: T1, status: 'confirming', phone: '213550123456' },
    ]);
    await openPrompt(fake as any, T1, '213550123456', 'confirm', 'o1');
    const sent: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: any) => {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
      })
    );

    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                messages: [
                  { id: 'm1', from: '213550123456', type: 'button', button: { payload: '1' } },
                ],
              },
            },
          ],
        },
      ],
    });
    const post = (sig: string | null) =>
      route.POST(
        new NextRequest('https://x.test/api/whatsapp/cloud/webhook', {
          method: 'POST',
          body: raw,
          headers: sig ? { 'x-hub-signature-256': sig } : {},
        })
      );

    expect((await post(null)).status).toBe(401);
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('confirming');

    expect((await post(sign(raw))).status).toBe(200);
    expect(fake.all('autotim', 'inbox_orders')[0].status).toBe('confirmed');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'text', to: '213550123456' });

    // Même message renvoyé par Meta → ignoré (aucun 2e accusé)
    await post(sign(raw));
    expect(sent).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
