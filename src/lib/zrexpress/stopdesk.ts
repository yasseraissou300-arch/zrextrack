// Adresse du bureau ZRExpress pour les colis « stop desk » : ajoutée aux
// notifications « en transit » / « en livraison » (« تستلمها من المكتب : … »).
//
// La ligne `orders` ne garde ni le type de livraison ZR ni le bureau : on lit
// le colis chez ZR au moment de la notification (≤ plafond journalier, donc
// quelques dizaines d'appels par jour au plus) et le bureau dans la liste
// mise en cache par loadZrGeo. Toute erreur → pas de ligne, la notification
// part comme avant.

import { ZREXPRESS_API } from '@/lib/zrexpress/parcels';
import { loadZrGeo, type PickupHub, type ZrAuth } from '@/lib/zrexpress/territories';

export const STOPDESK_STATUSES = new Set(['en_transit', 'en_livraison']);

/** Bureau en une ligne (paramètre de modèle WhatsApp : pas de retour à la ligne). */
export function officeText(hub: Pick<PickupHub, 'name' | 'street' | 'phone'>): string {
  const where = [hub.name, hub.street].filter(Boolean).join(' — ');
  return `المكتب : ${where}${hub.phone ? ` ☎ ${hub.phone}` : ''}`;
}

export function stopDeskLine(hub: Pick<PickupHub, 'name' | 'street' | 'phone'>): string {
  const where = [hub.name, hub.street].filter(Boolean).join(' — ');
  const phone = hub.phone ? `\n☎️ ${hub.phone}` : '';
  return `\n\n📍 تستلمها من المكتب : *${where}*${phone}`;
}

/** Bureau de retrait du colis, ou null (livraison à domicile, inconnu, erreur). */
export async function findParcelHub(
  auth: ZrAuth,
  tracking: string,
  fetchImpl: typeof fetch = fetch
): Promise<PickupHub | null> {
  if (!tracking) return null;
  try {
    const res = await fetchImpl(`${ZREXPRESS_API}/parcels/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': auth.token,
        'X-Tenant': auth.tenantId,
      },
      body: JSON.stringify({ keyword: tracking, pageNumber: 1, pageSize: 5 }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: Record<string, any>[] };
    const parcel = (json.items ?? []).find((p) => p.trackingNumber === tracking);
    if (!parcel || parcel.deliveryType !== 'pickup-point' || !parcel.hubDeliveryId) return null;
    const geo = await loadZrGeo(auth, fetchImpl);
    return geo?.hubs.find((h) => h.id === String(parcel.hubDeliveryId)) ?? null;
  } catch {
    return null;
  }
}

/** Ajoute l'adresse du bureau au message si le colis est en stop desk. */
export async function withStopDesk(
  auth: ZrAuth | null,
  status: string,
  tracking: string,
  message: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (!auth || !STOPDESK_STATUSES.has(status)) return message;
  const hub = await findParcelHub(auth, tracking, fetchImpl);
  return hub ? `${message.trimEnd()}${stopDeskLine(hub)}` : message;
}
