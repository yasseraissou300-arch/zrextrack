import { NextRequest, NextResponse } from 'next/server';
import { fetchAllParcels } from '@/lib/zrexpress/parcels';
import { normalizeParcel, isSwappable, isTarget, isSituationSwappable } from '@/lib/autoswap/matcher';
import type { ZRParcel } from '@/lib/autoswap/types';

// Diagnostic AutoSwap — dump la VÉRITÉ TERRAIN des champs ZRExpress.
//
// Sert à calibrer les filtres au lieu de deviner les noms d'états : renvoie la
// distribution réelle de `state` et `situation`, l'état du flag
// `swap.isEligibleForSwap`, et ce que la logique actuelle détecte.
// Read-only, aucune écriture.

function tally(values: string[]): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = v || '(vide)';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export async function POST(request: NextRequest) {
  try {
    const { token, tenantId } = await request.json();
    if (!token) return NextResponse.json({ error: 'Clé API manquante' }, { status: 400 });
    if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });

    const parcels = (await fetchAllParcels(token, tenantId)) as ZRParcel[];
    const normalized = parcels.map(normalizeParcel);

    const swapCounts = tally(normalized.map(p => String(p.swap.count)));
    const eligibleTrue = normalized.filter(p => p.swap.isEligibleForSwap === true).length;
    const bySituationRule = normalized.filter(p => isSituationSwappable(p.situation)).length;

    // Les colis que la règle situation attrape mais que le flag API rate —
    // c'est exactement l'écart qui causait « 1 swappable au lieu de 13 ».
    const flagMissed = normalized.filter(
      p => isSituationSwappable(p.situation) && p.swap.isEligibleForSwap !== true
    );

    return NextResponse.json({
      total_parcels: parcels.length,

      // Ce que la logique actuelle détecte
      detected: {
        swappables: normalized.filter(isSwappable).length,
        targets: normalized.filter(isTarget).length,
      },

      // Distribution brute — LA donnée qui permet de calibrer les filtres
      states: tally(normalized.map(p => p.stateName)),
      situations: tally(normalized.map(p => p.situation)),

      swap_fields: {
        isEligibleForSwap_true: eligibleTrue,
        matched_by_situation_rule: bySituationRule,
        flag_missed_but_situation_ok: flagMissed.length,
        count_distribution: swapCounts,
      },

      // Échantillon anonymisé pour vérifier la FORME des champs renvoyés
      sample_shape: parcels[0]
        ? {
            top_level_keys: Object.keys(parcels[0]).sort(),
            state_raw: (parcels[0] as any).state,
            situation_raw: (parcels[0] as any).situation,
            swap_raw: (parcels[0] as any).swap,
          }
        : null,

      // Aperçu des colis récupérés grâce au fallback situation
      recovered_examples: flagMissed.slice(0, 15).map(p => ({
        tracking: p.trackingNumber,
        state: p.stateName,
        situation: p.situation,
        swap_count: p.swap.count,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erreur diagnostic' }, { status: 500 });
  }
}
