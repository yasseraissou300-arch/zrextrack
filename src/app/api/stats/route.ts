import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServiceClient();

    // --- Répartition par statut ---
    const { data: allOrders } = await supabase
      .from('orders')
      .select('delivery_status, last_update');

    const distribution: Record<string, number> = {
      livre: 0, en_transit: 0, en_livraison: 0,
      en_preparation: 0, echec: 0, retourne: 0,
    };

    // --- Activité 7 derniers jours ---
    const daily: Record<string, { livrees: number; echecs: number; retours: number }> = {};
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      daily[key] = { livrees: 0, echecs: 0, retours: 0 };
    }

    for (const order of allOrders || []) {
      // Distribution globale
      if (order.delivery_status in distribution) distribution[order.delivery_status]++;

      // Activité journalière (basée sur last_update)
      if (!order.last_update) continue;
      const d = new Date(order.last_update);
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 6) continue;
      const key = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      if (!daily[key]) continue;
      if (order.delivery_status === 'livre') daily[key].livrees++;
      else if (order.delivery_status === 'echec') daily[key].echecs++;
      else if (order.delivery_status === 'retourne') daily[key].retours++;
    }

    return NextResponse.json({
      distribution,
      daily: Object.entries(daily).map(([day, counts]) => ({ day, ...counts })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
