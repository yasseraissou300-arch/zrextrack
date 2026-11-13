import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { internalErrorResponse } from '@/lib/security/public-error';
import { resolveTenant } from '@/lib/auth/tenant';

export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    // Suppression / corbeille / reclassement : réservés au propriétaire.
    if ((await resolveTenant(user)).role !== 'owner')
      return NextResponse.json({ error: 'Réservé au propriétaire du compte' }, { status: 403 });

    const { ids } = await request.json();
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'IDs manquants' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error, count } = await supabase
      .from('orders')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', ids)
      .eq('user_id', user.id);

    if (error) return internalErrorResponse('api.orders.delete', error);

    return NextResponse.json({ deleted: count ?? ids.length });
  } catch (err: any) {
    return internalErrorResponse('api.orders.delete', err);
  }
}
