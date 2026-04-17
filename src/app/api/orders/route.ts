import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '10', 10);
    const status = searchParams.get('status') || 'all';
    const situation = searchParams.get('situation') || '';
    const search = searchParams.get('search') || '';

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const supabase = createServiceClient();
    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    if (status !== 'all') query = query.eq('status', status);
    if (situation) query = query.ilike('situation', `%${situation}%`);
    if (search) query = query.or(`tracking.ilike.%${search}%,client.ilike.%${search}%`);

    query = query.order('last_update', { ascending: false }).range(from, to);

    const { data, count, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data: data || [], count: count || 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
