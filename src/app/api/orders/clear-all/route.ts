import { NextResponse } from 'next/server';
import { internalError } from '@/lib/security/safe-error';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function DELETE() {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const supabase = createServiceClient();

    const { error, count } = await supabase
      .from('orders')
      .delete({ count: 'exact' })
      .eq('user_id', user.id);

    if (error) return internalError('api.orders.clear-all', error);
    return NextResponse.json({ deleted: count ?? 0 });
  } catch (err: any) {
    return internalError('api.orders.clear-all', err);
  }
}
