'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Package, CheckCircle2, Truck, TrendingUp, MessageSquare, RotateCcw, XCircle, Boxes } from 'lucide-react';
import { SYNC_DONE_EVENT } from './DashboardHeader';

interface KPIData {
  totalOrders: number;
  delivered: number;
  deliveredToday: number;
  inTransit: number;
  enLivraison: number;
  enPreparation: number;
  deliveryRate: number;
  messagesSent: number;
  returned: number;
  failed: number;
}

const POLL_INTERVAL = 5_000;

export default function KPIBentoGrid() {
  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchKPIs = useCallback(async () => {
    try {
      const res = await fetch('/api/kpis');
      const json = await res.json();
      if (!json.error) setKpis(json);
    } catch (e) {
      console.error('KPI fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKPIs();
    const interval = setInterval(fetchKPIs, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchKPIs]);

  useEffect(() => {
    const handler = () => fetchKPIs();
    window.addEventListener(SYNC_DONE_EVENT, handler);
    return () => window.removeEventListener(SYNC_DONE_EVENT, handler);
  }, [fetchKPIs]);

  const val = (n: number | undefined) => (n ?? 0).toLocaleString('fr-FR');

  const cards = [
    {
      label: 'Total commandes',
      value: val(kpis?.totalOrders),
      icon: Package,
      borderColor: 'border-l-blue-500',
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-50',
    },
    {
      label: 'Livrées',
      value: val(kpis?.delivered),
      icon: CheckCircle2,
      borderColor: 'border-l-green-500',
      iconColor: 'text-green-600',
      iconBg: 'bg-green-50',
    },
    {
      label: "Livrées aujourd'hui",
      value: val(kpis?.deliveredToday),
      icon: CheckCircle2,
      borderColor: 'border-l-teal-500',
      iconColor: 'text-teal-600',
      iconBg: 'bg-teal-50',
    },
    {
      label: 'En préparation',
      value: val(kpis?.enPreparation),
      icon: Boxes,
      borderColor: 'border-l-purple-400',
      iconColor: 'text-purple-500',
      iconBg: 'bg-purple-50',
    },
    {
      label: 'En transit / livraison',
      value: val(kpis?.inTransit),
      icon: Truck,
      borderColor: 'border-l-amber-500',
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-50',
    },
    {
      label: 'Taux de livraison',
      value: `${kpis?.deliveryRate ?? 0}%`,
      icon: TrendingUp,
      borderColor: 'border-l-indigo-500',
      iconColor: 'text-indigo-600',
      iconBg: 'bg-indigo-50',
    },
    {
      label: 'Échecs',
      value: val(kpis?.failed),
      icon: XCircle,
      borderColor: 'border-l-red-400',
      iconColor: 'text-red-500',
      iconBg: 'bg-red-50',
    },
    {
      label: 'Messages WhatsApp',
      value: val(kpis?.messagesSent),
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
          className={`bg-white rounded-xl border border-gray-100 border-l-4 ${card.borderColor} p-4 shadow-sm`}
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2.5 ${card.iconBg}`}>
            <card.icon size={14} className={card.iconColor} />
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5 leading-tight">
            {card.label}
          </p>
          <p className="text-xl font-bold text-gray-900 tabular-nums">
            {loading ? <span className="text-gray-200 animate-pulse">—</span> : card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
