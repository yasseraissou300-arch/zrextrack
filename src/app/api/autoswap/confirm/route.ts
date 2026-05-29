// Enregistre un swap exécuté MANUELLEMENT dans ZRExpress.
//
// Contexte : ZRExpress n'autorise pas l'exécution des swaps via API externe
// (403 ApiKeyNotAllowed), donc /api/autoswap/execute échoue toujours et
// autoswap_log reste vide. L'utilisateur fait le swap à la main dans l'UI
// ZRExpress, puis vient ici cliquer "Marquer comme swappé" pour que l'app
// enregistre l'opération et alimente les statistiques (livré / annulé).
//
// On insère une ligne autoswap_log avec status='success' et un marqueur
// zr_response.manual=true pour distinguer des exécutions API (qui n'arrivent
// jamais en pratique). Les stats croisent ensuite source_tracking avec la
// table orders pour déterminer livré / annulé / en cours.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface ConfirmPayload {
  source_tracking?: string;
  target_tracking?: string;
  confidence?: 'EXACT' | 'STRONG' | 'WEAK';
  same_city?: boolean;
  estimated_savings?: number;
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: ConfirmPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const source = (body.source_tracking || '').trim();
  const target = (body.target_tracking || '').trim();
  if (!source || !target) {
    return NextResponse.json({ error: 'source_tracking et target_tracking requis' }, { status: 400 });
  }

  const confidence = body.confidence && ['EXACT', 'STRONG', 'WEAK'].includes(body.confidence)
    ? body.confidence
    : 'STRONG';

  const supabase = createServiceClient();

  // Anti-doublon : si ce couple (source, target) est déjà confirmé pour ce
  // user, on ne crée pas une 2e ligne (idempotent sur re-clic).
  const { data: existing } = await supabase
    .from('autoswap_log')
    .select('id')
    .eq('user_id', user.id)
    .eq('source_tracking', source)
    .eq('target_tracking', target)
    .eq('status', 'success')
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { error } = await supabase.from('autoswap_log').insert({
    source_tracking: source,
    target_tracking: target,
    confidence,
    same_city: body.same_city ?? null,
    estimated_savings: typeof body.estimated_savings === 'number' ? body.estimated_savings : 0,
    zr_response: { manual: true },
    status: 'success',
    user_id: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
