import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { internalErrorResponse } from '@/lib/security/public-error';
import { resolveTenant } from '@/lib/auth/tenant';

export async function DELETE() {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    // Suppression / corbeille / reclassement : réservés au propriétaire.
    if ((await resolveTenant(user)).role !== 'owner')
      return NextResponse.json({ error: 'Réservé au propriétaire du compte' }, { status: 403 });

    const supabase = createServiceClient();

    const { error, count } = await supabase
      .from('orders')
      .delete({ count: 'exact' })
      .eq('user_id', user.id);

    if (error) return internalErrorResponse('api.orders.clear-all', error);
    return NextResponse.json({ deleted: count ?? 0 });
  } catch (err: any) {
    return internalErrorResponse('api.orders.clear-all', err);
  }
}
