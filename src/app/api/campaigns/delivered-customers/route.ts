// Agrège les colis livrés depuis ZRExpress en une liste de clients dédupliqués,
// destinée au ciblage des campagnes WhatsApp.
//
// Source : ZRExpress /parcels/search (état « livre ») → groupé par téléphone.
// Pour chaque client on calcule :
//   - nom + wilaya (le plus récent observé)
//   - nb de commandes livrées
//   - total dépensé (somme des amount)
//   - date de la dernière livraison
//
// Sans persistance — la requête est faite à la demande, le résultat est juste
// envoyé au frontend. Évite d'avoir une copie obsolète en DB.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchAllParcels } from '@/app/api/sync-zrexpress/route';

interface DeliveredCustomer {
  phone: string;             // ex « 213556172674 »
  name: string;
  wilaya: string;            // nom de la wilaya (ex « Oran »)
  wilaya_code: number;
  order_count: number;       // nombre de commandes livrées
  total_spent: number;       // somme des montants COD livrés
  last_delivery: string;     // ISO date string
  trackings: string[];       // jusqu'à 5 derniers tracking numbers
}

// État ZRExpress qui correspond à « colis livré ». L'état exact dans la
// réponse de l'API peut varier — on accepte plusieurs formes pour robustesse.
function isDelivered(stateName: string | undefined): boolean {
  const s = (stateName || '').toLowerCase();
  return s.includes('livre') || s === 'delivered' || s === 'livraison_effectuee';
}

function normalizePhoneKey(raw: string | undefined): string {
  const clean = (raw || '').replace(/[\s\-()+.]/g, '');
  if (clean.startsWith('213')) return clean;
  if (clean.startsWith('0')) return '213' + clean.slice(1);
  if (clean.length === 9) return '213' + clean;
  return clean;
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { token, tenantId } = await request.json().catch(() => ({}));
  if (!token) return NextResponse.json({ error: 'Clé API ZRExpress manquante' }, { status: 400 });
  if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });

  let parcels: any[];
  try {
    parcels = await fetchAllParcels(token, tenantId);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur ZRExpress' }, { status: 502 });
  }

  // Index par téléphone normalisé
  const byPhone = new Map<string, DeliveredCustomer>();

  for (const p of parcels) {
    if (!isDelivered(p?.state?.name)) continue;

    const phones = [
      p.customer?.phone?.number1,
      p.customer?.phone?.number2,
      p.customer?.phone?.number3,
    ].filter(Boolean) as string[];
    const primaryPhone = phones[0];
    if (!primaryPhone) continue;

    const key = normalizePhoneKey(primaryPhone);
    if (!key || key.length < 11) continue;

    const amount = Number(p.amount ?? 0);
    const name = p.customer?.name || '';
    const wilaya = p.deliveryAddress?.city || '';
    const wilayaCode = Number(p.deliveryAddress?.cityTerritoryCode ?? 0);
    // ZRExpress n'expose pas un champ « date livraison » standard sur tous
    // les comptes. On se rabat sur updatedAt > createdAt si présents.
    const lastUpdate = p.updatedAt || p.createdAt || new Date().toISOString();
    const tracking = p.trackingNumber || '';

    const existing = byPhone.get(key);
    if (!existing) {
      byPhone.set(key, {
        phone: key,
        name,
        wilaya,
        wilaya_code: wilayaCode,
        order_count: 1,
        total_spent: amount,
        last_delivery: lastUpdate,
        trackings: tracking ? [tracking] : [],
      });
    } else {
      existing.order_count += 1;
      existing.total_spent += amount;
      // Garde la livraison la plus récente comme « dernière »
      if (new Date(lastUpdate) > new Date(existing.last_delivery)) {
        existing.last_delivery = lastUpdate;
        // Et met à jour le nom/wilaya si on a une donnée plus fraîche
        if (name) existing.name = name;
        if (wilaya) {
          existing.wilaya = wilaya;
          existing.wilaya_code = wilayaCode;
        }
      }
      if (tracking && existing.trackings.length < 5) {
        existing.trackings.push(tracking);
      }
    }
  }

  const customers = Array.from(byPhone.values())
    // Trie par client le plus récent en premier
    .sort((a, b) => new Date(b.last_delivery).getTime() - new Date(a.last_delivery).getTime());

  // Stats globales pour l'entête du tableau
  const stats = {
    total_customers: customers.length,
    total_orders: customers.reduce((s, c) => s + c.order_count, 0),
    total_revenue: customers.reduce((s, c) => s + c.total_spent, 0),
    repeat_customers: customers.filter(c => c.order_count >= 2).length,
  };

  return NextResponse.json({ customers, stats });
}
