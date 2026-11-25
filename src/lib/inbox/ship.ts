// Envoi d'une commande confirmée à ZRExpress (création du colis).
//
// Le colis est RÉEL : il apparaît chez ZR et part en ramassage. Donc :
//   - seules les commandes « confirmées » peuvent partir ;
//   - le marchand valide wilaya / commune / type de livraison / montant dans
//     une fenêtre avant l'envoi (rien n'est créé automatiquement) ;
//   - une commande ne peut pas créer deux colis : prise optimiste sur
//     updated_at + verrou « envoi en cours » de 2 minutes.

import type { createServiceClient } from '@/lib/supabase/server';
import { ZREXPRESS_API } from '@/lib/zrexpress/parcels';
import type { ZrAuth } from '@/lib/zrexpress/territories';

type Service = ReturnType<typeof createServiceClient>;

export interface ShipChoice {
  wilayaId: string;
  communeId: string;
  deliveryType: 'home' | 'pickup-point';
  hubId?: string | null;
  amount: number;
  description: string;
  street?: string;
}

export interface ShipOrderRow {
  id: string;
  status: string;
  customer_name: string;
  phone: string;
  address: string;
  updated_at: string;
  zr_error: string | null;
  zr_tracking: string | null;
}

export const SENDING_MARK = '__envoi_en_cours__';
const LOCK_MS = 2 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** « 213550123456 » → « 0550123456 » (format attendu par ZR). */
export function localPhone(phone: string): string {
  return phone.startsWith('213') ? '0' + phone.slice(3) : phone;
}

export function validateChoice(c: Partial<ShipChoice>): string | null {
  if (!c.wilayaId || !UUID.test(c.wilayaId)) return 'Wilaya manquante';
  if (!c.communeId || !UUID.test(c.communeId)) return 'Commune manquante';
  if (c.deliveryType !== 'home' && c.deliveryType !== 'pickup-point')
    return 'Type de livraison invalide';
  if (c.deliveryType === 'pickup-point' && (!c.hubId || !UUID.test(c.hubId)))
    return 'Choisissez le bureau (stop desk)';
  if (!Number.isFinite(c.amount) || (c.amount as number) < 0 || (c.amount as number) > 1_000_000)
    return 'Montant invalide';
  if (!String(c.description ?? '').trim()) return 'Produit manquant';
  return null;
}

export function buildParcelRequest(o: ShipOrderRow, c: ShipChoice): Record<string, unknown> {
  return {
    customer: { name: o.customer_name || 'Client', phone: { number1: localPhone(o.phone) } },
    deliveryAddress: {
      cityTerritoryId: c.wilayaId,
      districtTerritoryId: c.communeId,
      street: (c.street ?? o.address ?? '').slice(0, 250) || null,
    },
    deliveryType: c.deliveryType,
    hubId: c.deliveryType === 'pickup-point' ? c.hubId : null,
    description: c.description.slice(0, 250),
    amount: Math.round(c.amount),
    weight: { weight: 1 },
    externalId: `AT-${o.id}`,
  };
}

export type CreateParcel = (
  auth: ZrAuth,
  body: Record<string, unknown>
) => Promise<{ ok: true; tracking: string } | { ok: false; status: number; message: string }>;

export const createZrParcel: CreateParcel = async (auth, body) => {
  try {
    const res = await fetch(`${ZREXPRESS_API}/parcels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': auth.token,
        'X-Tenant': auth.tenantId,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (res.ok && json.trackingNumber) return { ok: true, tracking: String(json.trackingNumber) };
    // Message ZR lisible (jamais le jeton ni la requête)
    const detail =
      json.detail ||
      json.title ||
      (json.errors && Object.values(json.errors).flat().slice(0, 2).join(' · ')) ||
      json.message ||
      '';
    return { ok: false, status: res.status, message: String(detail).slice(0, 200) };
  } catch {
    return { ok: false, status: 0, message: 'ZRExpress injoignable' };
  }
};

const inbox = (s: Service) => s.schema('autotim').from('inbox_orders');

export type ShipResult =
  | { ok: true; tracking: string }
  | {
      ok: false;
      reason: 'not_found' | 'not_confirmed' | 'busy' | 'invalid' | 'zr_error';
      message?: string;
    };

export async function shipInboxOrder(
  service: Service,
  tenantId: string,
  orderId: string,
  choice: ShipChoice,
  auth: ZrAuth,
  create: CreateParcel = createZrParcel,
  now: number = Date.now()
): Promise<ShipResult> {
  const invalid = validateChoice(choice);
  if (invalid) return { ok: false, reason: 'invalid', message: invalid };

  const { data: rows, error } = await inbox(service)
    .select('id, status, customer_name, phone, address, updated_at, zr_error, zr_tracking')
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .limit(1);
  if (error || !rows?.length) return { ok: false, reason: 'not_found' };
  const o = rows[0] as ShipOrderRow;
  if (o.status !== 'confirmed' || o.zr_tracking) return { ok: false, reason: 'not_confirmed' };
  if (o.zr_error === SENDING_MARK && now - Date.parse(o.updated_at) < LOCK_MS)
    return { ok: false, reason: 'busy' };

  // Prise optimiste : un seul appel obtient la ligne (updated_at inchangé).
  const at = new Date(now).toISOString();
  const { data: claimed } = await inbox(service)
    .update({ zr_error: SENDING_MARK, updated_at: at })
    .eq('id', o.id)
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .eq('updated_at', o.updated_at)
    .select('id');
  if (!claimed?.length) return { ok: false, reason: 'busy' };

  const r = await create(auth, buildParcelRequest(o, choice));
  if (!r.ok) {
    const message = r.message || `ZRExpress HTTP ${r.status}`;
    await inbox(service)
      .update({ zr_error: message.slice(0, 300), updated_at: new Date().toISOString() })
      .eq('id', o.id)
      .eq('tenant_id', tenantId);
    return { ok: false, reason: 'zr_error', message };
  }
  await inbox(service)
    .update({
      status: 'sent',
      zr_tracking: r.tracking,
      zr_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', o.id)
    .eq('tenant_id', tenantId);
  return { ok: true, tracking: r.tracking };
}
