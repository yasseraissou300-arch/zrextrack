// Normalisation d'un colis ZRExpress vers la ligne `orders`.
//
// Extrait de src/app/api/sync-zrexpress/route.ts pour être partagé entre la
// route HTTP (bouton « Synchroniser » manuel) et le handler de file (Phase 1).
//
// Comportement STRICTEMENT identique à l'original : mêmes champs, mêmes
// fallbacks, même appel à mapStatus. Aucune règle métier modifiée.
//
// La longue cascade de fallbacks est volontaire : l'API ZRExpress n'est pas
// cohérente d'un endpoint à l'autre sur le nom de ses champs.

import { mapStatus } from './status';

export interface MappedOrder {
  tracking_number: string;
  customer_name: string;
  customer_whatsapp: string;
  wilaya: string;
  product_name: string;
  cod: number;
  delivery_status: string;
  attempts: number;
  last_update: string;
}

export function mapParcel(p: any, syncedAt: string): MappedOrder {
  const tracking =
    p.trackingNumber || p.trackingCode || p.tracking_code || p.tracking || p.barcode || p.id || '';

  const client =
    p.customer?.name || p.recipientName || p.recipient_name || p.clientName || p.client_name || '';

  const phoneObj =
    p.customer?.phone && typeof p.customer.phone === 'object' ? p.customer.phone : {};
  const whatsapp =
    phoneObj.number1 ||
    phoneObj.number2 ||
    phoneObj.number3 ||
    (typeof p.customer?.phone === 'string' ? p.customer.phone : '') ||
    p.recipientPhone ||
    p.recipient_phone ||
    p.phone ||
    '';

  const wilaya =
    p.deliveryAddress?.city ||
    p.wilaya?.name ||
    p.wilayaName ||
    p.wilaya_name ||
    p.wilaya ||
    p.city ||
    '';

  const product =
    p.productsDescription ||
    p.description ||
    (p.orderedProducts && p.orderedProducts.length > 0 ? p.orderedProducts[0].productName : '') ||
    p.productName ||
    p.product_name ||
    p.product?.name ||
    '';

  const cod = p.amount ?? p.price ?? p.cod ?? p.codAmount ?? p.cod_amount ?? 0;

  const rawStatus =
    p.state?.name || p.stateName || p.status?.name || p.statusName || p.state || p.status || '';
  const situation =
    p.situation?.name ||
    p.situationName ||
    p.lastSituation?.name ||
    p.lastSituationName ||
    p.situation ||
    '';

  // La situation prime sur l'état — règle métier portée par mapStatus.
  const status = mapStatus(rawStatus, situation);
  const attempts = p.deliveryAttempts ?? p.delivery_attempts ?? p.attempts ?? 0;

  return {
    tracking_number: String(tracking),
    customer_name: String(client),
    customer_whatsapp: String(whatsapp),
    wilaya: String(wilaya),
    product_name: String(product),
    cod: Number(cod),
    delivery_status: status,
    attempts: Number(attempts),
    last_update: syncedAt,
  };
}

/** Déduplique une liste de colis mappés sur le tracking_number. */
export function dedupeByTracking(rows: MappedOrder[]): MappedOrder[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.tracking_number || seen.has(r.tracking_number)) return false;
    seen.add(r.tracking_number);
    return true;
  });
}
