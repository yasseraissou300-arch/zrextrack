// Adresse du bureau ZR ajoutée aux notifications des colis « stop desk ».

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findParcelHub, stopDeskLine, withStopDesk } from '@/lib/zrexpress/stopdesk';
import { __resetTerritoryCache } from '@/lib/zrexpress/territories';

const HUB = '33333333-3333-4333-8333-000000000001';
const auth = { token: 't', tenantId: 'zr' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function zrMock(parcel: Record<string, unknown> | null) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/parcels/search'))
      return json({ items: parcel ? [parcel] : [], hasNext: false });
    if (url.endsWith('/territories/search')) return json({ items: [], hasNext: false });
    if (url.endsWith('/hubs/search'))
      return json({
        items: [
          {
            id: HUB,
            name: 'Bureau Oran Centre',
            isPickupPoint: true,
            isVisible: true,
            address: { street: 'Rue Larbi Ben Mhidi', cityTerritoryId: 'w-oran' },
            phone: { number1: '0550 00 00 00' },
          },
        ],
        hasNext: false,
      });
    throw new Error(`inattendu : ${url}`);
  });
}

beforeEach(() => __resetTerritoryCache());

describe('stopDeskLine', () => {
  it('nom, adresse et téléphone du bureau', () => {
    expect(stopDeskLine({ name: 'Bureau Oran', street: 'Rue X', phone: '0550' })).toBe(
      '\n\n📍 تستلمها من المكتب : *Bureau Oran — Rue X*\n☎️ 0550'
    );
    expect(stopDeskLine({ name: 'Bureau Oran', street: '', phone: '' })).toBe(
      '\n\n📍 تستلمها من المكتب : *Bureau Oran*'
    );
  });
});

describe('withStopDesk', () => {
  it('colis stop desk « en livraison » → adresse du bureau ajoutée', async () => {
    const f = zrMock({ trackingNumber: 'ZR-1', deliveryType: 'pickup-point', hubDeliveryId: HUB });
    const m = await withStopDesk(auth, 'en_livraison', 'ZR-1', 'Votre colis arrive', f as any);
    expect(m).toContain('Votre colis arrive');
    expect(m).toContain('Bureau Oran Centre — Rue Larbi Ben Mhidi');
    expect(m).toContain('0550 00 00 00');
  });

  it('livraison à domicile → message inchangé', async () => {
    const f = zrMock({ trackingNumber: 'ZR-1', deliveryType: 'home' });
    expect(await withStopDesk(auth, 'en_livraison', 'ZR-1', 'msg', f as any)).toBe('msg');
  });

  it('autre statut ou pas d’identifiants ZR → aucun appel', async () => {
    const f = zrMock(null);
    expect(await withStopDesk(auth, 'livre', 'ZR-1', 'msg', f as any)).toBe('msg');
    expect(await withStopDesk(null, 'en_livraison', 'ZR-1', 'msg', f as any)).toBe('msg');
    expect(f).not.toHaveBeenCalled();
  });

  it('ZR en panne → message inchangé (jamais d’erreur)', async () => {
    const f = vi.fn(async () => {
      throw new Error('réseau');
    });
    expect(await withStopDesk(auth, 'en_transit', 'ZR-1', 'msg', f as any)).toBe('msg');
  });

  it('le colis trouvé doit porter exactement ce numéro de suivi', async () => {
    const f = zrMock({
      trackingNumber: 'ZR-999',
      deliveryType: 'pickup-point',
      hubDeliveryId: HUB,
    });
    expect(await findParcelHub(auth, 'ZR-1', f as any)).toBeNull();
  });
});
