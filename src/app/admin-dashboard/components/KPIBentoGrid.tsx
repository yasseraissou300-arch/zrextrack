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
    {
      label: 'Total Commandes',
      value: kpis.totalOrders.toLocaleString('fr-FR'),
      icon: Package,
      borderColor: 'border-l-blue-500',
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-50',
    },
    {
      label: "Livrées aujourd'hui",
      value: kpis.deliveredToday.toString(),
      icon: CheckCircle2,
      borderColor: 'border-l-green-500',
      iconColor: 'text-green-600',
      iconBg: 'bg-green-50',
    },
    {
      label: 'En transit / livraison',
      value: kpis.inTransit.toString(),
      icon: Truck,
      borderColor: 'border-l-amber-500',
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-50',
    },
    {
      label: 'Taux de livraison',
      value: `${kpis.deliveryRate}%`,
      icon: TrendingUp,
      borderColor: 'border-l-indigo-500',
      iconColor: 'text-indigo-600',
      iconBg: 'bg-indigo-50',
    },
    {
      label: 'Messages envoyés',
      value: kpis.messagesSent.toLocaleString('fr-FR'),
      icon: MessageSquare,
      borderColor: 'border-l-teal-500',
      iconColor: 'text-teal-600',
      iconBg: 'bg-teal-50',
    },
    {
      label: 'Retournés',
      value: kpis.returned.toString(),
      icon: RotateCcw,
      borderColor: 'border-l-red-500',
      iconColor: 'text-red-500',
      iconBg: 'bg-red-50',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`bg-white rounded-xl border border-gray-100 border-l-4 ${card.borderColor} p-4 shadow-sm`}
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${card.iconBg}`}>
            <card.icon size={16} className={card.iconColor} />
          </div>
          <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">
            {card.label}
          </p>
          <p className="text-2xl font-bold text-gray-900">
            {loading ? <span className="text-gray-300">—</span> : card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
