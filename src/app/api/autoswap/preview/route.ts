import { NextRequest, NextResponse } from 'next/server';
import { internalError } from '@/lib/security/safe-error';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchAllParcels } from '@/lib/zrexpress/parcels';
import { getZrCredentials, ZR_NOT_CONFIGURED } from '@/lib/zrexpress/credentials';
import { matchSwappables, splitSourcesAndTargets } from '@/lib/autoswap/matcher';
import type { PreviewResponse, ZRParcel } from '@/lib/autoswap/types';

// Route read-only : récupère TOUS les colis ZRExpress, identifie les swappables
// et les commandes confirmées en attente, puis applique l'algorithme de matching
// avec les équivalences de tailles PERSONNALISÉES du user courant.
// Aucune écriture en DB, aucun POST ZRExpress.
export async function POST(request: NextRequest) {
  try {
    // Session obligatoire ; clé ZR lue en base pour ce tenant (P2-9) — une clé
    // envoyée dans le corps est ignorée.
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const service = createServiceClient();
    const zr = await getZrCredentials(service, user.id);
    if (!zr) return NextResponse.json(ZR_NOT_CONFIGURED, { status: 400 });
    const { token, tenantId } = zr;

    // Charge les équivalences du user — chaque utilisateur a sa propre config
    // (ex : ami A vend du hijab miral, ami B vend autre chose avec autres groupes).
    const sizeEquivalences: Record<string, string[][]> = {};
    {
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
    return internalError('api.autoswap.preview', err);
  }
}
