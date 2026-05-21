import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchAllParcels } from '@/app/api/sync-zrexpress/route';
import { matchSwappables, splitSourcesAndTargets } from '@/lib/autoswap/matcher';
import type { PreviewResponse, ZRParcel } from '@/lib/autoswap/types';

// Route read-only : récupère TOUS les colis ZRExpress, identifie les swappables
// et les commandes confirmées en attente, puis applique l'algorithme de matching
// avec les équivalences de tailles PERSONNALISÉES du user courant.
// Aucune écriture en DB, aucun POST ZRExpress.
export async function POST(request: NextRequest) {
  try {
    const { token, tenantId } = await request.json();
    if (!token) return NextResponse.json({ error: 'Clé API (secretKey) manquante' }, { status: 400 });
    if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });

    // Charge les équivalences du user — chaque utilisateur a sa propre config
    // (ex : ami A vend du hijab miral, ami B vend autre chose avec autres groupes).
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();

    let sizeEquivalences: Record<string, string[][]> = {};
    if (user) {
      const service = createServiceClient();
      const { data: rows } = await service
        .from('autoswap_size_equivalences')
        .select('product_key, groups')
        .eq('user_id', user.id);
      if (rows) {
        for (const r of rows) {
          sizeEquivalences[r.product_key as string] = r.groups as string[][];
        }
      }
    }

    const parcels = (await fetchAllParcels(token, tenantId)) as ZRParcel[];

    const { swappables, targets } = splitSourcesAndTargets(parcels);
    const proposals = matchSwappables(parcels, { sizeEquivalences });

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
