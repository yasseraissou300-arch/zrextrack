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
import { mapStatus } from '@/lib/zrexpress/status';

// Statuts internes (sortie de mapStatus) considérés comme livraison réussie.
const DELIVERED = new Set(['livre']);
// Statuts considérés comme commande annulée (échec définitif ou retour).
const CANCELLED = new Set(['echec', 'retourne']);

type Bucket = 'delivered' | 'cancelled' | 'in_progress';

interface SwappedItem {
  id: string;            // UUID du colis (pour le lien ZRExpress)
  tracking: string;
  customer: string;
  wilaya: string;
  state_raw: string;     // état brut ZRExpress (ex "Retour", "Livré")
  situation_raw: string; // situation brute (souvent la vraie raison)
  status: string;        // statut interne mappé
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
      const status = mapStatus(rawState, situation);

      let bucket: Bucket;
      if (DELIVERED.has(status)) { bucket = 'delivered'; delivered += 1; }
      else if (CANCELLED.has(status)) { bucket = 'cancelled'; cancelled += 1; }
      else { bucket = 'in_progress'; inProgress += 1; }

      items.push({
        id: String(p.id || ''),
        tracking: String(p.trackingNumber || p.trackingCode || p.tracking || ''),
        customer: String(p.customer?.name || p.recipientName || ''),
        wilaya: String(p.deliveryAddress?.city || p.wilaya?.name || p.wilaya || ''),
        state_raw: rawState,
        situation_raw: situation,
        status,
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
