// Statistiques des commandes DÉJÀ swappées — détection automatique.
//
// ZRExpress expose sur chaque colis un champ `swap` avec :
//   - swap.count    : nombre de fois que ce colis a été swappé (0 = jamais)
//   - swap.swappedAt : date du dernier swap (null si jamais)
//
// On n'a donc PAS besoin que l'utilisateur marque manuellement ses swaps :
// il suffit de récupérer tous les colis et de garder ceux où swap.count > 0
// (ou swappedAt non-null), puis de les classer par statut de livraison
// (livré / annulé / en cours) avec la MÊME logique que la sync (mapStatus).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchAllParcels } from '@/app/api/sync-zrexpress/route';
import { classifySwappedDelivery, type DeliveryBucket } from '@/lib/zrexpress/status';

type Bucket = DeliveryBucket;

interface SwappedItem {
  id: string;            // UUID du colis (pour le lien ZRExpress)
  tracking: string;
  customer: string;
  wilaya: string;
  state_raw: string;     // état brut ZRExpress (ex "Sortie en livraison", "Livré")
  situation_raw: string; // situation brute (souvent l'ANCIENNE raison pré-swap)
  bucket: Bucket;
  swap_count: number;
  swapped_at: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const { token, tenantId } = await request.json();
    if (!token) return NextResponse.json({ error: 'Clé API (secretKey) manquante' }, { status: 400 });
    if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });

    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Récupère tous les colis ZRExpress du compte (token = compte du user)
    const parcels = await fetchAllParcels(token, tenantId) as any[];

    const items: SwappedItem[] = [];
    let delivered = 0;
    let cancelled = 0;
    let inProgress = 0;

    for (const p of parcels) {
      const swapCount = Number(p?.swap?.count ?? 0);
      const swappedAt = p?.swap?.swappedAt ?? null;
      const isSwapped = swapCount > 0 || !!swappedAt;
      if (!isSwapped) continue;

      const rawState = String(p.state?.name || p.stateName || p.status?.name || p.statusName || p.state || p.status || '');
      const situation = String(p.situation?.name || p.situationName || p.lastSituation?.name || p.lastSituationName || p.situation || '');

      // IMPORTANT : pour un colis swappé on classe sur l'ÉTAT de livraison,
      // pas sur la situation (qui garde souvent l'ancienne raison d'échec pré-swap).
      const bucket = classifySwappedDelivery(rawState);
      if (bucket === 'delivered') delivered += 1;
      else if (bucket === 'cancelled') cancelled += 1;
      else inProgress += 1;

      items.push({
        id: String(p.id || ''),
        tracking: String(p.trackingNumber || p.trackingCode || p.tracking || ''),
        customer: String(p.customer?.name || p.recipientName || ''),
        wilaya: String(p.deliveryAddress?.city || p.wilaya?.name || p.wilaya || ''),
        state_raw: rawState,
        situation_raw: situation,
        bucket,
        swap_count: swapCount,
        swapped_at: swappedAt,
      });
    }

    const total = items.length;
    const deliveryRate = total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0;

    return NextResponse.json({
      total_swapped: total,
      delivered,
      cancelled,
      in_progress: inProgress,
      delivery_rate: deliveryRate,
      items,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erreur statistiques swaps' }, { status: 500 });
  }
}
