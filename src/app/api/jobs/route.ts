// Consultation de la file — Phase 1.
//
// Sert à voir la DLQ : sans cela, un job mort disparaîtrait silencieusement,
// exactement le défaut de l'existant où une notification en échec était perdue.
//
// Toujours scopé au tenant authentifié : un utilisateur ne voit jamais les
// jobs d'un autre, même en forgeant la requête.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { QUEUE_SCHEMA, type JobStatus } from '@/lib/queue/types';

const STATUTS: JobStatus[] = ['pending', 'running', 'done', 'failed', 'dead'];

export async function GET(req: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get('status');
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200);

  const service = createServiceClient();
  let q = service
    .schema(QUEUE_SCHEMA)
    .from('jobs')
    .select(
      'id, type, status, attempts, max_attempts, run_after, last_error, created_at, updated_at'
    )
    .eq('tenant_id', user.id) // ← scoping tenant, non négociable
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (statusParam && (STATUTS as string[]).includes(statusParam)) {
    q = q.eq('status', statusParam);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compteurs par statut, pour l'UI.
  const counts: Record<string, number> = {};
  for (const s of STATUTS) {
    const { count } = await service
      .schema(QUEUE_SCHEMA)
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', user.id)
      .eq('status', s);
    counts[s] = count ?? 0;
  }

  return NextResponse.json({ jobs: data ?? [], counts });
}
