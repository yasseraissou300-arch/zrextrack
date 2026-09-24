import { NextRequest, NextResponse } from 'next/server';
import { internalError } from '@/lib/security/safe-error';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { ids } = await request.json();
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'IDs manquants' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error, count } = await supabase
      .from('orders')
      .update({ deleted_at: null })
      .in('id', ids)
      .eq('user_id', user.id);

    if (error) return internalError('api.orders.restore', error);

    return NextResponse.json({ restored: count ?? ids.length });
  } catch (err: any) {
    return internalError('api.orders.restore', err);
  }
}
