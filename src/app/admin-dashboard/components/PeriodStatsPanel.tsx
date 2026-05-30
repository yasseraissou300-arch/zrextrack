'use client';

// Résumé statistique par période : Aujourd'hui + 7 derniers jours.
// Données depuis /api/stats (agrégats today / last7days, basés sur last_update).

import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, RotateCcw, Truck, Package, TrendingUp } from 'lucide-react';
import { SYNC_DONE_EVENT } from './DashboardHeader';

interface Agg {
  livrees: number;
  echecs: number;
  retours: number;
  en_cours: number;
  total: number;
}

const EMPTY: Agg = { livrees: 0, echecs: 0, retours: 0, en_cours: 0, total: 0 };

function rate(a: Agg): number {
  const finalized = a.livrees + a.echecs + a.retours;
  return finalized > 0 ? Math.round((a.livrees / finalized) * 1000) / 10 : 0;
}

function StatLine({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-2 text-sm text-gray-600 dark:text-stone-300">
        <span className={color}>{icon}</span>
        {label}
      </span>
      <span className="font-bold tabular-nums text-gray-900 dark:text-stone-100">{value}</span>
    </div>
  );
}

function PeriodCard({ title, subtitle, agg, accent }: { title: string; subtitle: string; agg: Agg; accent: string }) {
  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-stone-100">{title}</h3>
          <p className="text-xs text-gray-400 dark:text-stone-500">{subtitle}</p>
        </div>
        <div className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${accent}`}>
          <Package size={12} />
          {agg.total} traitées
        </div>
      </div>

      <div className="divide-y divide-stone-50 dark:divide-stone-800">
        <StatLine icon={<CheckCircle2 size={15} />} label="Livrées" value={agg.livrees} color="text-green-600" />
        <StatLine icon={<XCircle size={15} />} label="Échecs" value={agg.echecs} color="text-red-500" />
        <StatLine icon={<RotateCcw size={15} />} label="Retours" value={agg.retours} color="text-gray-400 dark:text-stone-500" />
        <StatLine icon={<Truck size={15} />} label="En cours" value={agg.en_cours} color="text-blue-500" />
      </div>

      <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <TrendingUp size={13} /> Taux de livraison
        </span>
        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{rate(agg)}%</span>
      </div>
    </div>
  );
}

export default function PeriodStatsPanel() {
  const [today, setToday] = useState<Agg>(EMPTY);
  const [week, setWeek] = useState<Agg>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stats', { cache: 'no-store' });
      const json = await res.json();
      if (json.today) setToday(json.today);
      if (json.last7days) setWeek(json.last7days);
    } catch { /* silencieux */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener(SYNC_DONE_EVENT, h);
    return () => window.removeEventListener(SYNC_DONE_EVENT, h);
  }, [load]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="h-44 bg-stone-50 dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 animate-pulse" />
        <div className="h-44 bg-stone-50 dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <PeriodCard
        title="Aujourd'hui"
        subtitle="Activité du jour"
        agg={today}
        accent="bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400"
      />
      <PeriodCard
        title="7 derniers jours"
        subtitle="Cumul sur la semaine"
        agg={week}
        accent="bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
      />
    </div>
  );
}
