'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Package, CheckCircle2, Truck, MessageSquare, XCircle, Boxes, Sparkles } from 'lucide-react';
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

interface TodayAgg {
  livrees: number;
  echecs: number;
  retours: number;
  en_cours: number;
  total: number;
}

const TODAY_EMPTY: TodayAgg = { livrees: 0, echecs: 0, retours: 0, en_cours: 0, total: 0 };

const POLL_INTERVAL = 5_000;

export default function KPIBentoGrid() {
  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [today, setToday] = useState<TodayAgg>(TODAY_EMPTY);
  const [loading, setLoading] = useState(true);

  const fetchKPIs = useCallback(async () => {
    try {
      // KPIs globaux (cartes secondaires) + agrégat du jour (carte hero)
      const [kpiRes, statsRes] = await Promise.all([
        fetch('/api/kpis'),
        fetch('/api/stats', { cache: 'no-store' }),
      ]);
      const kpiJson = await kpiRes.json();
      if (!kpiJson.error) setKpis(kpiJson);
      const statsJson = await statsRes.json().catch(() => ({}));
      if (statsJson.today) setToday(statsJson.today);
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

  // Taux de livraison DU JOUR (livrées / commandes finalisées aujourd'hui)
  const todayFinalized = today.livrees + today.echecs + today.retours;
  const todayRate = todayFinalized > 0 ? Math.round((today.livrees / todayFinalized) * 1000) / 10 : 0;

  const secondaryCards: Array<{
    label: string;
    value: string;
    icon: typeof Package;
    iconColor: string;
    iconBg: string;
  }> = [
    { label: 'Total commandes',       value: val(kpis?.totalOrders),     icon: Package,        iconColor: 'text-violet-600 dark:text-violet-300',  iconBg: 'bg-violet-100 dark:bg-violet-500/15' },
    { label: 'Livrées (total)',        value: val(kpis?.delivered),       icon: CheckCircle2,   iconColor: 'text-emerald-600 dark:text-emerald-300', iconBg: 'bg-emerald-100 dark:bg-emerald-500/15' },
    { label: 'Échecs aujourd\'hui',    value: val(today.echecs),          icon: XCircle,        iconColor: 'text-rose-600 dark:text-rose-300',       iconBg: 'bg-rose-100 dark:bg-rose-500/15' },
    { label: 'En préparation',         value: val(kpis?.enPreparation),   icon: Boxes,          iconColor: 'text-amber-600 dark:text-amber-300',     iconBg: 'bg-amber-100 dark:bg-amber-500/15' },
    { label: 'En transit / livraison', value: val(kpis?.inTransit),       icon: Truck,          iconColor: 'text-blue-600 dark:text-blue-300',       iconBg: 'bg-blue-100 dark:bg-blue-500/15' },
    { label: 'Échecs (total)',         value: val(kpis?.failed),          icon: XCircle,        iconColor: 'text-rose-600 dark:text-rose-300',       iconBg: 'bg-rose-100 dark:bg-rose-500/15' },
    { label: 'Messages WhatsApp',      value: val(kpis?.messagesSent),    icon: MessageSquare,  iconColor: 'text-fuchsia-600 dark:text-fuchsia-300', iconBg: 'bg-fuchsia-100 dark:bg-fuchsia-500/15' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
      {/* HERO CARD — taux de livraison, gradient violet→fuchsia */}
      <div
        className="col-span-2 row-span-2 relative overflow-hidden rounded-2xl p-5 text-white shadow-lg shadow-violet-500/25 bg-gradient-to-br from-violet-500 via-violet-600 to-fuchsia-500 animate-slide-up"
        style={{ animationDelay: '0ms', animationFillMode: 'backwards' }}
      >
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />

        <div className="relative flex flex-col h-full">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-white/90 leading-tight">Aujourd'hui</p>
              <p className="text-[10px] text-white/60">Livraisons du jour</p>
            </div>
          </div>

          <div className="mt-auto">
            <div className="flex items-end gap-2">
              <p className="text-4xl xl:text-5xl font-bold tabular-nums tracking-tight">
                {loading ? <span className="text-white/30 animate-pulse">—</span> : val(today.livrees)}
              </p>
              <p className="text-sm font-medium text-white/70 mb-1.5">livrées</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/85">
              <span className="px-2 py-0.5 rounded-full bg-white/15 backdrop-blur-sm font-medium">
                {val(today.total)} traitées
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/15 backdrop-blur-sm font-medium">
                taux {todayRate}%
              </span>
              {today.echecs > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-rose-400/25 backdrop-blur-sm font-medium">
                  {val(today.echecs)} échecs
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SECONDARY CARDS — staggered animation */}
      {secondaryCards.map((card, idx) => (
        <div
          key={card.label}
          className="group bg-white dark:bg-stone-900 rounded-xl border border-stone-100 dark:border-stone-800 p-3.5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-slide-up"
          style={{ animationDelay: `${50 + idx * 40}ms`, animationFillMode: 'backwards' }}
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2.5 ${card.iconBg} group-hover:scale-105 transition-transform`}>
            <card.icon size={15} className={card.iconColor} />
          </div>
          <p className="text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-0.5 leading-tight">
            {card.label}
          </p>
          <p className="text-xl font-bold text-stone-900 dark:text-stone-100 tabular-nums tracking-tight">
            {loading ? <span className="text-stone-200 dark:text-stone-700 animate-pulse">—</span> : card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
