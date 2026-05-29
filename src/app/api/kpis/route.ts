import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const supabase = createServiceClient();
    const today = new Date().toISOString().split('T')[0];
    const uid = user.id;

    const [totalRes, deliveredRes, deliveredTodayRes, transitRes, livraisonRes, returnedRes, failedRes, prepRes, messagesRes] =
      await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('delivery_status', 'livre'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('delivery_status', 'livre').gte('last_update', today),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('delivery_status', 'en_transit'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('delivery_status', 'en_livraison'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('delivery_status', 'retourne'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('delivery_status', 'echec'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('delivery_status', 'en_preparation'),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      ]);

    const total = totalRes.count ?? 0;
    const delivered = deliveredRes.count ?? 0;
    const rate = total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0;

    return NextResponse.json({
      totalOrders: total,
      delivered,
      deliveredToday: deliveredTodayRes.count ?? 0,
      inTransit: (transitRes.count ?? 0) + (livraisonRes.count ?? 0),
      enTransit: transitRes.count ?? 0,
      enLivraison: livraisonRes.count ?? 0,
      enPreparation: prepRes.count ?? 0,
      returned: returnedRes.count ?? 0,
      failed: failedRes.count ?? 0,
      deliveryRate: rate,
      messagesSent: messagesRes.count ?? 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
