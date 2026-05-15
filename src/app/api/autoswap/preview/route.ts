import { NextRequest, NextResponse } from 'next/server';
import { fetchAllParcels } from '@/app/api/sync-zrexpress/route';
import { matchSwappables, splitSourcesAndTargets } from '@/lib/autoswap/matcher';
import type { PreviewResponse, ZRParcel } from '@/lib/autoswap/types';

// Route read-only : récupère TOUS les colis ZRExpress, identifie les swappables
// (swap.isEligibleForSwap=true) et les commandes confirmées en attente (state=appel_confirmation),
// puis applique l'algorithme de matching. Aucune écriture en DB, aucun POST ZRExpress.
export async function POST(request: NextRequest) {
  try {
    const { token, tenantId } = await request.json();
    if (!token) return NextResponse.json({ error: 'Clé API (secretKey) manquante' }, { status: 400 });
    if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });

    const parcels = (await fetchAllParcels(token, tenantId)) as ZRParcel[];

    const { swappables, targets } = splitSourcesAndTargets(parcels);
    const proposals = matchSwappables(parcels);

    const byConfidence = { EXACT: 0, STRONG: 0, WEAK: 0 };
    let totalSavings = 0;
    for (const p of proposals) {
      byConfidence[p.confidence] += 1;
      totalSavings += p.estimated_savings;
    }

    const response: PreviewResponse = {
      proposals,
      stats: {
        total_parcels: parcels.length,
        total_swappable: swappables.length,
        total_targets: targets.length,
        matches_count: proposals.length,
        total_savings: totalSavings,
        by_confidence: byConfidence,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erreur AutoSwap preview' }, { status: 500 });
  }
}
