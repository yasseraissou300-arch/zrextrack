import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// Seuils en heures par statut
const THRESHOLDS: Record<string, number> = {
  en_preparation: 48,
  en_transit: 72,
  en_livraison: 48,
};

export async function GET() {
  try {
    const supabase = createServiceClient();
    const now = new Date();

    const stuckOrders: any[] = [];

    for (const [status, hours] of Object.entries(THRESHOLDS)) {
      const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

      const { data } = await supabase
        .from('orders')
        .select('id, tracking_number, customer_name, wilaya, delivery_status, last_update')
        .eq('delivery_status', status)
        .lt('last_update', cutoff)
        .order('last_update', { ascending: true })
        .limit(10);

      if (data) {
        for (const order of data) {
          const diffMs = now.getTime() - new Date(order.last_update).getTime();
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          stuckOrders.push({ ...order, tracking: order.tracking_number, client: order.customer_name, status: order.delivery_status, hours: diffHours });
        }
      }
    }

    // Trier par ancienneté décroissante
    stuckOrders.sort((a, b) => b.hours - a.hours);

    return NextResponse.json({ data: stuckOrders.slice(0, 10) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
