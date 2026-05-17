'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Package, CheckCircle2, Truck, TrendingUp, MessageSquare, XCircle, Boxes, Sparkles } from 'lucide-react';
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

  // Hero KPI — taux de livraison (le plus parlant pour un e-commerce)
  const heroValue = `${kpis?.deliveryRate ?? 0}%`;

  // Cards secondaires
  const secondaryCards: Array<{
    label: string;
    value: string;
    icon: typeof Package;
    iconColor: string;
    iconBg: string;
  }> = [
    { label: 'Total commandes',       value: val(kpis?.totalOrders),     icon: Package,        iconColor: 'text-violet-600', iconBg: 'bg-violet-100' },
    { label: 'Livrées',                value: val(kpis?.delivered),       icon: CheckCircle2,   iconColor: 'text-emerald-600', iconBg: 'bg-emerald-100' },
    { label: "Livrées aujourd'hui",    value: val(kpis?.deliveredToday),  icon: Sparkles,       iconColor: 'text-teal-600',    iconBg: 'bg-teal-100' },
    { label: 'En préparation',         value: val(kpis?.enPreparation),   icon: Boxes,          iconColor: 'text-amber-600',   iconBg: 'bg-amber-100' },
    { label: 'En transit / livraison', value: val(kpis?.inTransit),       icon: Truck,          iconColor: 'text-blue-600',    iconBg: 'bg-blue-100' },
    { label: 'Échecs',                 value: val(kpis?.failed),          icon: XCircle,        iconColor: 'text-rose-600',    iconBg: 'bg-rose-100' },
    { label: 'Messages WhatsApp',      value: val(kpis?.messagesSent),    icon: MessageSquare,  iconColor: 'text-fuchsia-600', iconBg: 'bg-fuchsia-100' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
      {/* HERO CARD — taux de livraison, gradient violet→fuchsia */}
      <div
        className="col-span-2 row-span-2 relative overflow-hidden rounded-3xl p-6 text-white shadow-xl shadow-violet-500/30 bg-gradient-to-br from-violet-500 via-violet-600 to-fuchsia-500"
      >
        {/* Decorative gradient orb */}
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />

        <div className="relative flex flex-col h-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <TrendingUp size={24} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-white/80">Taux de livraison</p>
              <p className="text-[11px] text-white/60">Tous statuts confondus</p>
            </div>
          </div>

          <div className="mt-auto">
            <p className="text-5xl xl:text-6xl font-bold tabular-nums tracking-tight">
              {loading ? <span className="text-white/30 animate-pulse">—</span> : heroValue}
            </p>
            <div className="mt-4 flex items-center gap-3 text-xs text-white/80">
              <span className="px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-sm font-medium">
                {val(kpis?.delivered)} livrées
              </span>
              <span className="text-white/40">·</span>
              <span>sur {val(kpis?.totalOrders)} commandes</span>
            </div>
          </div>
        </div>
      </div>

      {/* SECONDARY CARDS */}
      {secondaryCards.map((card) => (
        <div
          key={card.label}
          className="group bg-white rounded-2xl border border-stone-100 p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${card.iconBg} group-hover:scale-105 transition-transform`}>
            <card.icon size={20} className={card.iconColor} />
          </div>
          <p className="text-xs font-medium text-stone-500 mb-1 leading-tight">
            {card.label}
          </p>
          <p className="text-2xl font-bold text-stone-900 tabular-nums tracking-tight">
            {loading ? <span className="text-stone-200 animate-pulse">—</span> : card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
