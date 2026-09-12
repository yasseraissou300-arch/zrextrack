import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchAllParcels } from '@/lib/zrexpress/parcels';
import {
  normalizeParcel,
  isSwappable,
  isTarget,
  isSituationSwappable,
  analyzePairForDiagnostic,
} from '@/lib/autoswap/matcher';
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

    // Charge les équivalences de tailles du user pour un diagnostic fidèle
    // (sans elles, l'analyse rejetterait des paires que le user considère
    // interchangeables).
    const sizeEquivalences: Record<string, string[][]> = {};
    try {
      const supabaseAuth = await createClient();
      const {
        data: { user },
      } = await supabaseAuth.auth.getUser();
      if (user) {
        const service = createServiceClient();
        const { data: rows } = await service
          .from('autoswap_size_equivalences')
          .select('product_key, groups')
          .eq('user_id', user.id);
        for (const r of rows || [])
          sizeEquivalences[r.product_key as string] = r.groups as string[][];
      }
    } catch {
      /* équivalences optionnelles : diagnostic reste exploitable sans */
    }

    const parcels = (await fetchAllParcels(token, tenantId)) as ZRParcel[];
    const normalized = parcels.map(normalizeParcel);

    const swapCounts = tally(normalized.map((p) => String(p.swap.count)));
    const eligibleTrue = normalized.filter((p) => p.swap.isEligibleForSwap === true).length;
    const bySituationRule = normalized.filter((p) => isSituationSwappable(p.situation)).length;

    // Les colis que la règle situation attrape mais que le flag API rate —
    // c'est exactement l'écart qui causait « 1 swappable au lieu de 13 ».
    const flagMissed = normalized.filter(
      (p) => isSituationSwappable(p.situation) && p.swap.isEligibleForSwap !== true
    );

    // ─── Analyse par paire (swappable × target) : histogramme des motifs de
    // rejet + échantillon des paires les plus proches d'un match. Permet de
    // comprendre pourquoi « 0 propositions » quand on a 17 × 44 = 748 paires
    // potentielles. Chaque motif pointe une piste d'action différente :
    //   diff_product      → produits vraiment sans overlap → normal
    //   no_color_info     → parsing produit à améliorer (description opaque)
    //   diff_quantity     → colis multi-articles vs single → matcher OK
    //   no_color_common   → clients veulent une autre couleur → normal
    //   no_size_common    → suggère d'ajouter des équivalences de tailles
    const swappables = normalized.filter(isSwappable);
    const targets = normalized.filter(isTarget);

    const rejectTally: Record<string, number> = {};
    let matchCount = 0;
    const nearMisses: Array<{
      swappable: string;
      target: string;
      product: string;
      reason: string;
      details: string;
    }> = [];

    for (const s of swappables) {
      for (const t of targets) {
        const r = analyzePairForDiagnostic(s, t, sizeEquivalences);
        if (r.kind === 'match') {
          matchCount++;
        } else {
          rejectTally[r.reason] = (rejectTally[r.reason] ?? 0) + 1;
          // Sample : garder les rejets liés au produit (mêmes produits mais
          // couleur/taille qui coincent) — les plus exploitables.
          if (
            nearMisses.length < 20 &&
            ['no_color_common', 'no_size_common', 'diff_quantity'].includes(r.reason)
          ) {
            nearMisses.push({
              swappable: s.trackingNumber,
              target: t.trackingNumber,
              product: s.productName || s.productNameFingerprint || '(inconnu)',
              reason: r.reason,
              details:
                r.reason === 'no_color_common'
                  ? `source [${s.variantColors.join(',')}] vs cible [${t.variantColors.join(',')}]`
                  : r.reason === 'no_size_common'
                    ? `source [${s.variantSizes.join(',')}] vs cible [${t.variantSizes.join(',')}]`
                    : `source qty=${s.quantity} vs cible qty=${t.quantity}`,
            });
          }
        }
      }
    }

    const rejectReasonsSorted = Object.entries(rejectTally)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      total_parcels: parcels.length,

      // Ce que la logique actuelle détecte
      detected: {
        swappables: normalized.filter(isSwappable).length,
        targets: normalized.filter(isTarget).length,
      },

      // Distribution brute — LA donnée qui permet de calibrer les filtres
      states: tally(normalized.map((p) => p.stateName)),
      situations: tally(normalized.map((p) => p.situation)),

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
      recovered_examples: flagMissed.slice(0, 15).map((p) => ({
        tracking: p.trackingNumber,
        state: p.stateName,
        situation: p.situation,
        swap_count: p.swap.count,
      })),

      // Analyse pair-à-pair pour comprendre l'origine de « 0 matchs »
      pair_analysis: {
        total_pairs: swappables.length * targets.length,
        matches: matchCount,
        reject_reasons: rejectReasonsSorted,
        near_misses: nearMisses,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erreur diagnostic' }, { status: 500 });
  }
}
