'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Package, CheckCircle2, Truck, TrendingUp, MessageSquare, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { SYNC_DONE_EVENT } from './DashboardHeader';

interface KPIData {
  totalOrders: number;
  delivered: number;
  deliveredToday: number;
  inTransit: number;
  deliveryRate: number;
  messagesSent: number;
  returned: number;
  failed: number;
}

const POLL_INTERVAL = 5_000; // 5 secondes

export default function KPIBentoGrid() {
  const [kpis, setKpis] = useState<KPIData>({
    totalOrders: 0, delivered: 0, deliveredToday: 0, inTransit: 0,
    deliveryRate: 0, messagesSent: 0, returned: 0, failed: 0,
  });
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchKPIs = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];

      const [totalRes, deliveredRes, deliveredTodayRes, transitRes, returnedRes, failedRes, messagesRes] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'livre'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'livre').gte('last_update', today),
        supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['en_transit', 'en_livraison']),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'retourne'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'echec'),
        supabase.from('messages').select('id', { count: 'exact', head: true }),
      ]);

      const total = totalRes.count ?? 0;
      const delivered = deliveredRes.count ?? 0;
      const rate = total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0;

      setKpis({
        totalOrders: total,
        delivered,
        deliveredToday: deliveredTodayRes.count ?? 0,
        inTransit: transitRes.count ?? 0,
        deliveryRate: rate,
        messagesSent: messagesRes.count ?? 0,
        returned: returnedRes.count ?? 0,
        failed: failedRes.count ?? 0,
      });
    } catch (e) {
      console.error('KPI error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Polling toutes les 5 secondes
  useEffect(() => {
    fetchKPIs();
    const interval = setInterval(fetchKPIs, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchKPIs]);

  // Rafraîchir immédiatement après un sync
  useEffect(() => {
    const handler = () => fetchKPIs();
    window.addEventListener(SYNC_DONE_EVENT, handler);
    return () => window.removeEventListener(SYNC_DONE_EVENT, handler);
  }, [fetchKPIs]);

  const cards = [
    {
      label: 'Total commandes',
      value: kpis.totalOrders.toLocaleString('fr-FR'),
      icon: Package,
      borderColor: 'border-l-blue-500',
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-50',
    },
    {
      label: 'Livrées au total',
      value: kpis.delivered.toLocaleString('fr-FR'),
      icon: CheckCircle2,
      borderColor: 'border-l-green-500',
      iconColor: 'text-green-600',
      iconBg: 'bg-green-50',
    },
    {
      label: "Livrées aujourd'hui",
      value: kpis.deliveredToday.toString(),
      icon: CheckCircle2,
      borderColor: 'border-l-teal-500',
      iconColor: 'text-teal-600',
      iconBg: 'bg-teal-50',
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
      label: 'Échecs',
      value: kpis.failed.toString(),
      icon: RotateCcw,
      borderColor: 'border-l-red-400',
      iconColor: 'text-red-500',
      iconBg: 'bg-red-50',
    },
    {
      label: 'Retournés',
      value: kpis.returned.toString(),
      icon: RotateCcw,
      borderColor: 'border-l-gray-400',
      iconColor: 'text-gray-500',
      iconBg: 'bg-gray-100',
    },
    {
      label: 'Messages WhatsApp',
      value: kpis.messagesSent.toLocaleString('fr-FR'),
      icon: MessageSquare,
      borderColor: 'border-l-green-400',
      iconColor: 'text-green-500',
      iconBg: 'bg-green-50',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`bg-white rounded-xl border border-gray-100 border-l-4 ${card.borderColor} p-4 shadow-sm transition-all`}
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2.5 ${card.iconBg}`}>
            <card.icon size={14} className={card.iconColor} />
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5 leading-tight">
            {card.label}
          </p>
          <p className="text-xl font-bold text-gray-900 tabular-nums">
            {loading ? <span className="text-gray-200">—</span> : card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
