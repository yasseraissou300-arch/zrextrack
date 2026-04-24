import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServiceClient();
    const today = new Date().toISOString().split('T')[0];

    const [totalRes, deliveredRes, deliveredTodayRes, transitRes, livraisonRes, returnedRes, failedRes, prepRes, messagesRes] =
      await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'livre'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'livre').gte('last_update', today),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'en_transit'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'en_livraison'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'retourne'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'echec'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'en_preparation'),
        supabase.from('messages').select('id', { count: 'exact', head: true }),
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
