import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import type { MatchProposal, ExecuteResponse, ExecutionResult } from '@/lib/autoswap/types';

// ⚠️ L'endpoint Swap officiel ZRExpress n'est pas encore documenté.
// Pour activer l'exécution réelle :
//   1. Inspecter https://app.zrexpress.app/parcel-swap dans Chrome DevTools → onglet Network
//   2. Cliquer manuellement sur "Swap" pour un colis
//   3. Récupérer l'URL exacte + méthode + payload de la requête sortante
//   4. Renseigner ZREXPRESS_SWAP_ENDPOINT dans .env.local (URL ABSOLUE)
//   5. Adapter buildSwapPayload() ci-dessous si le format diffère du défaut
const DEFAULT_SWAP_ENDPOINT = 'https://api.zrexpress.app/api/v1.0/parcels/swap';

function buildSwapPayload(swap: MatchProposal) {
  // Format présumé — à confirmer après inspection des DevTools.
  return {
    sourceParcelId: swap.swappable.id,
    targetParcelId: swap.target.id,
  };
}

async function callZRExpressSwap(
  token: string,
  tenantId: string,
  endpoint: string,
  swap: MatchProposal,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Api-Key': token,
      'X-Tenant': tenantId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildSwapPayload(swap)),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export async function POST(request: NextRequest) {
  try {
    const { token, tenantId, approved_swaps } = (await request.json()) as {
      token?: string;
      tenantId?: string;
      approved_swaps?: MatchProposal[];
    };

    if (!token) return NextResponse.json({ error: 'Clé API manquante' }, { status: 400 });
    if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });
    if (!Array.isArray(approved_swaps) || approved_swaps.length === 0) {
      return NextResponse.json({ error: 'Aucun swap validé fourni' }, { status: 400 });
    }

    const endpoint = process.env.ZREXPRESS_SWAP_ENDPOINT || DEFAULT_SWAP_ENDPOINT;

    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    const userId = user?.id ?? null;
    const supabase = createServiceClient();

    const results: ExecutionResult[] = [];
    let executed = 0;
    let failed = 0;

    // Exécution séquentielle pour respecter le rate-limit ZRExpress et permettre
    // une trace claire en cas d'erreur. Pas de rollback global : chaque swap est indépendant.
    for (const swap of approved_swaps) {
      let result: ExecutionResult;
      try {
        const { ok, status, body } = await callZRExpressSwap(token, tenantId, endpoint, swap);
        if (ok) {
          executed += 1;
          result = {
            source_tracking: swap.swappable.tracking,
            target_tracking: swap.target.tracking,
            status: 'success',
            zr_response: body,
          };

          // Met à jour la table orders : ancien colis → swap_redirected, nouveau → swap_shipped
          await supabase
            .from('orders')
            .update({ delivery_status: 'swap_redirected', last_update: new Date().toISOString() })
            .eq('tracking_number', swap.swappable.tracking);
          await supabase
            .from('orders')
            .update({ delivery_status: 'swap_shipped', last_update: new Date().toISOString() })
            .eq('tracking_number', swap.target.tracking);
        } else {
          failed += 1;
          result = {
            source_tracking: swap.swappable.tracking,
            target_tracking: swap.target.tracking,
            status: 'failed',
            error: `ZRExpress HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`,
            zr_response: body,
          };
        }
      } catch (err: any) {
        failed += 1;
        result = {
          source_tracking: swap.swappable.tracking,
          target_tracking: swap.target.tracking,
          status: 'failed',
          error: err?.message || 'Erreur réseau inconnue',
        };
      }

      // Audit log (best-effort — n'arrête pas l'exécution si ça échoue).
      await supabase.from('autoswap_log').insert({
        source_tracking: swap.swappable.tracking,
        target_tracking: swap.target.tracking,
        confidence: swap.confidence,
        same_city: swap.same_city,
        estimated_savings: swap.estimated_savings,
        zr_response: result.zr_response ?? null,
        status: result.status,
        error_message: result.error ?? null,
        user_id: userId,
      }).select();

      results.push(result);
    }

    const response: ExecuteResponse = { executed, failed, results };
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erreur AutoSwap execute' }, { status: 500 });
  }
}
