'use client';

import React, { useEffect, useState } from 'react';
import { Package, CheckCircle2, Truck, TrendingUp, MessageSquare, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface KPIData {
  totalOrders: number;
  deliveredToday: number;
  inTransit: number;
  deliveryRate: number;
  messagesSent: number;
  returned: number;
}

export default function KPIBentoGrid() {
  const [kpis, setKpis] = useState<KPIData>({
    totalOrders: 0, deliveredToday: 0, inTransit: 0,
    deliveryRate: 0, messagesSent: 0, returned: 0,
  });
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    fetchKPIs();
  }, []);

  const fetchKPIs = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      const [ordersRes, deliveredRes, transitRes, returnedRes, messagesRes] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .eq('status', 'livre').gte('last_update', today),
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .in('status', ['en_transit', 'en_livraison']),
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .eq('status', 'retourne'),
        supabase.from('messages').select('id', { count: 'exact', head: true }),
      ]);

      const total = ordersRes.count || 0;
      const delivered = ordersRes.count ? (
        await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'livre')
      ).count || 0 : 0;

      const rate = total > 0 ? Math.round((delivered / total) * 100 * 10) / 10 : 0;

      setKpis({
        totalOrders: total,
        deliveredToday: deliveredRes.count || 0,
        inTransit: transitRes.count || 0,
        deliveryRate: rate,
        messagesSent: messagesRes.count || 0,
        returned: returnedRes.count || 0,
      });
    } catch (e) {
      console.error('KPI error:', e);
    }
    setLoading(false);
  };

  const cards = [
    { label: 'Total Commandes', value: kpis.totalOrders.toLocaleString('fr-FR'), icon: Package, color: 'blue', span: 2 },
    { label: "Livrées aujourd'hui", value: kpis.deliveredToday.toString(), icon: CheckCircle2, color: 'green', span: 1 },
    { label: 'En transit', value: kpis.inTransit.toString(), icon: Truck, color: 'amber', span: 1 },
    { label: 'Taux de livraison', value: `${kpis.deliveryRate}%`, icon: TrendingUp, color: 'indigo', span: 1 },
    { label: 'Messages envoyés', value: kpis.messagesSent.toLocaleString('fr-FR'), icon: MessageSquare, color: 'green', span: 1 },
    { label: 'Retournés', value: kpis.returned.toString(), icon: RotateCcw, color: 'red', span: 1 },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    red: 'bg-red-50 text-red-600 border-red-100',
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`bg-white rounded-2xl border p-4 shadow-sm ${card.span === 2 ? 'sm:col-span-2 xl:col-span-2' : ''}`}
        >
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-3 ${colorMap[card.color]}`}>
            <card.icon size={20} />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {loading ? '—' : card.value}
          </p>
          <p className="text-sm text-gray-500 mt-1">{card.label}</p>
        </div>
      ))}
    </div>
  );
}
