import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getZrCredentials, ZR_NOT_CONFIGURED } from '@/lib/zrexpress/credentials';
import type {
  MatchProposal,
  ExecuteResponse,
  ExecutionResult,
  SwapRequestPayload,
} from '@/lib/autoswap/types';

// Endpoint découvert via le spec Swagger interne ZRExpress :
//   https://api.zrexpress.app/swagger/internal-v1/swagger.json
//   → POST /api/v1.0/parcel-modification-requests/swap
//   → operationId : CreateSwapParcelModificationRequestEndpoint
//   → permissions requises : SupplierAdminRole | SupplierParcelsManagerRole
const SWAP_URL =
  process.env.ZREXPRESS_SWAP_ENDPOINT ||
  'https://api.zrexpress.app/api/v1.0/parcel-modification-requests/swap';

// Construit le payload conforme au schéma CreateSwapParcelModificationRequestRequest.
// Le swap prend le colis SOURCE (déjà en mouvement chez le livreur) et le redirige
// vers les coordonnées du client TARGET (nouvelle commande confirmée).
function buildSwapPayload(swap: MatchProposal): SwapRequestPayload {
  const t = swap.target;
  return {
    parcelId: swap.swappable.id,
    amount: t.amount,
    phone: t.swapPayload.phone,
    deliveryType: t.swapPayload.deliveryType,
    deliveryAddress: t.swapPayload.deliveryAddress,
    hubId: t.swapPayload.hubId,
    newCustomerName: t.customer || null,
    newCustomerId: t.swapPayload.customerId,
  };
}

async function callZRExpressSwap(
  token: string,
  tenantId: string,
  swap: MatchProposal
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(SWAP_URL, {
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
    // Clé ZR lue en base pour le tenant de la session (P2-9) ; un `token`
    // envoyé dans le corps est ignoré.
    const { approved_swaps } = (await request.json()) as {
      approved_swaps?: MatchProposal[];
    };

    if (!Array.isArray(approved_swaps) || approved_swaps.length === 0) {
      return NextResponse.json({ error: 'Aucun swap validé fourni' }, { status: 400 });
    }

    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const userId = user.id;
    const supabase = createServiceClient();
    const zr = await getZrCredentials(supabase, userId);
    if (!zr) return NextResponse.json(ZR_NOT_CONFIGURED, { status: 400 });
    const { token, tenantId } = zr;

    const results: ExecutionResult[] = [];
    let executed = 0;
    let failed = 0;

    // Exécution séquentielle pour respecter le rate-limit ZRExpress et permettre
    // une trace claire en cas d'erreur. Pas de rollback global : chaque swap est indépendant.
    for (const swap of approved_swaps) {
      let result: ExecutionResult;
      try {
        const { ok, status, body } = await callZRExpressSwap(token, tenantId, swap);
        if (ok) {
          executed += 1;
          result = {
            source_tracking: swap.swappable.tracking,
            target_tracking: swap.target.tracking,
            status: 'success',
            zr_response: body,
          };

          const now = new Date().toISOString();
          await supabase
            .from('orders')
            .update({ delivery_status: 'swap_redirected', last_update: now })
            .eq('tracking_number', swap.swappable.tracking)
            .eq('user_id', userId);
          await supabase
            .from('orders')
            .update({ delivery_status: 'swap_shipped', last_update: now })
            .eq('tracking_number', swap.target.tracking)
            .eq('user_id', userId);
        } else {
          failed += 1;
          result = {
            source_tracking: swap.swappable.tracking,
            target_tracking: swap.target.tracking,
            status: 'failed',
            error: `ZRExpress HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`,
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

      await supabase
        .from('autoswap_log')
        .insert({
          source_tracking: swap.swappable.tracking,
          target_tracking: swap.target.tracking,
          confidence: swap.confidence,
          same_city: swap.same_city,
          estimated_savings: swap.estimated_savings,
          zr_response: result.zr_response ?? null,
          status: result.status,
          error_message: result.error ?? null,
          user_id: userId,
        })
        .select();

      results.push(result);
    }

    return NextResponse.json({ executed, failed, results } as ExecuteResponse);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erreur AutoSwap execute' }, { status: 500 });
  }
}
