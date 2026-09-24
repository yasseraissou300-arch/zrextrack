import { NextRequest, NextResponse } from 'next/server';
import { internalError } from '@/lib/security/safe-error';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createServiceClient();
  const { data, count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order('sent_at', { ascending: false })
    .range(from, to);

  if (error) return internalError('api.messages', error);
  return NextResponse.json({ data: data || [], count: count || 0 });
}
