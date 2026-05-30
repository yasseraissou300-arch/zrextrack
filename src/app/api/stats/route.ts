import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const supabase = createServiceClient();

    // --- Répartition par statut ---
    const { data: allOrders } = await supabase
      .from('orders')
      .select('delivery_status, last_update')
      .eq('user_id', user.id);

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

    // --- Agrégats par période (basés sur last_update) ---
    // "Aujourd'hui" = même date calendaire que maintenant. "7 jours" = derniers 7 jours.
    type Agg = { livrees: number; echecs: number; retours: number; en_cours: number; total: number };
    const today: Agg = { livrees: 0, echecs: 0, retours: 0, en_cours: 0, total: 0 };
    const last7days: Agg = { livrees: 0, echecs: 0, retours: 0, en_cours: 0, total: 0 };
    const EN_COURS = new Set(['en_transit', 'en_livraison', 'en_preparation']);
    const todayKey = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const bump = (agg: Agg, status: string) => {
      agg.total++;
      if (status === 'livre') agg.livrees++;
      else if (status === 'echec') agg.echecs++;
      else if (status === 'retourne') agg.retours++;
      else if (EN_COURS.has(status)) agg.en_cours++;
    };

    for (const order of allOrders || []) {
      // Distribution globale
      if (order.delivery_status in distribution) distribution[order.delivery_status]++;

      // Activité journalière (basée sur last_update)
      if (!order.last_update) continue;
      const d = new Date(order.last_update);
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 6) continue;

      // Agrégat 7 jours
      bump(last7days, order.delivery_status);
      // Agrégat aujourd'hui (même date calendaire)
      if (d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) === todayKey) {
        bump(today, order.delivery_status);
      }

      const key = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      if (!daily[key]) continue;
      if (order.delivery_status === 'livre') daily[key].livrees++;
      else if (order.delivery_status === 'echec') daily[key].echecs++;
      else if (order.delivery_status === 'retourne') daily[key].retours++;
    }

    return NextResponse.json({
      distribution,
      daily: Object.entries(daily).map(([day, counts]) => ({ day, ...counts })),
      today,
      last7days,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
