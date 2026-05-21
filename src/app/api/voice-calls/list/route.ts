// Liste les appels passés pour l'utilisateur courant + stats agrégées.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '100', 10), 500);

  const service = createServiceClient();
  const { data: calls, error } = await service
    .from('voice_calls')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list = calls ?? [];
  const stats = {
    total: list.length,
    confirmed: list.filter(c => c.outcome === 'confirmed').length,
    cancelled: list.filter(c => c.outcome === 'cancelled').length,
    no_answer: list.filter(c => c.outcome === 'no_answer' || c.outcome === 'no_response').length,
    failed: list.filter(c => c.outcome === 'failed').length,
    total_cost_da: list.reduce((s, c) => s + Number(c.cost_da || 0), 0),
    total_duration_seconds: list.reduce((s, c) => s + Number(c.duration_seconds || 0), 0),
  };

  return NextResponse.json({ data: list, stats });
}
