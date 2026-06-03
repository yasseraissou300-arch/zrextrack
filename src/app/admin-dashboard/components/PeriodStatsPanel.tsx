'use client';

// Résumé statistique par période, avec sélecteur Aujourd'hui / 7 derniers jours.
// "Aujourd'hui" est la vue par défaut.
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

const TILES = [
  { key: 'livrees' as const, label: 'Livrées', icon: CheckCircle2, fg: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  { key: 'echecs'  as const, label: 'Échecs',  icon: XCircle,      fg: 'text-red-500',   bg: 'bg-red-50 dark:bg-red-900/20' },
  { key: 'retours' as const, label: 'Retours', icon: RotateCcw,    fg: 'text-gray-500 dark:text-stone-400', bg: 'bg-gray-50 dark:bg-stone-800/60' },
  { key: 'en_cours' as const, label: 'En cours', icon: Truck,      fg: 'text-blue-500',  bg: 'bg-blue-50 dark:bg-blue-900/20' },
];

type Period = 'today' | '7days';

export default function PeriodStatsPanel() {
  const [today, setToday] = useState<Agg>(EMPTY);
  const [week, setWeek] = useState<Agg>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('today'); // Aujourd'hui par défaut

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
    return <div className="h-52 bg-stone-50 dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 animate-pulse" />;
  }

  const agg = period === 'today' ? today : week;
  const subtitle = period === 'today' ? "Activité du jour" : "Cumul de l'activité sur la semaine";

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm p-6">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-stone-100">
            {period === 'today' ? "Aujourd'hui" : '7 derniers jours'}
          </h2>
          <p className="text-xs text-gray-400 dark:text-stone-500 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400">
            <Package size={14} />
            {agg.total} traitées
          </span>
          {/* Sélecteur de période — Aujourd'hui par défaut */}
          <div className="inline-flex bg-stone-100 dark:bg-stone-800 rounded-lg p-0.5">
            <button
              onClick={() => setPeriod('today')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${period === 'today' ? 'bg-white dark:bg-stone-900 text-violet-700 dark:text-violet-300 shadow-sm' : 'text-stone-500 dark:text-stone-400'}`}
            >
              Aujourd'hui
            </button>
            <button
              onClick={() => setPeriod('7days')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${period === '7days' ? 'bg-white dark:bg-stone-900 text-violet-700 dark:text-violet-300 shadow-sm' : 'text-stone-500 dark:text-stone-400'}`}
            >
              7 derniers jours
            </button>
          </div>
        </div>
      </div>

      {/* 4 grandes tuiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TILES.map(t => {
          const Icon = t.icon;
          return (
            <div key={t.key} className={`rounded-xl p-4 ${t.bg}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <Icon size={16} className={t.fg} />
                <span className="text-xs font-medium text-gray-500 dark:text-stone-400">{t.label}</span>
              </div>
              <div className="text-3xl font-bold tabular-nums text-gray-900 dark:text-stone-100">{agg[t.key]}</div>
            </div>
          );
        })}
      </div>

      {/* Taux de livraison — bandeau */}
      <div className="mt-5">
        <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl px-5 py-4">
          <span className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            <TrendingUp size={16} /> Taux de livraison ({period === 'today' ? "aujourd'hui" : '7 jours'})
          </span>
          <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{rate(agg)}%</span>
        </div>
      </div>

      {agg.total === 0 && (
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-3">
          Aucune activité {period === 'today' ? "aujourd'hui" : 'sur les 7 derniers jours'}.
          {period === 'today' && <span className="text-gray-400 dark:text-stone-500"> Essayez « 7 derniers jours ».</span>}
        </p>
      )}
    </div>
  );
}
