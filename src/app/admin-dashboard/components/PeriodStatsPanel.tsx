'use client';

// Résumé statistique par période.
// "7 derniers jours" = carte principale en grand format.
// "Aujourd'hui" = carte secondaire compacte.
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

// ─── Carte principale (grand format) ─────────────────────────────────────────
function HeroCard({ agg }: { agg: Agg }) {
  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm p-6 h-full flex flex-col">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-stone-100">7 derniers jours</h2>
          <p className="text-xs text-gray-400 dark:text-stone-500 mt-0.5">Cumul de l'activité sur la semaine</p>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
          <Package size={14} />
          {agg.total} commandes traitées
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
      <div className="mt-auto pt-5">
        <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl px-5 py-4">
          <span className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            <TrendingUp size={16} /> Taux de livraison (7 jours)
          </span>
          <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{rate(agg)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Carte secondaire (compacte) ─────────────────────────────────────────────
function CompactCard({ agg }: { agg: Agg }) {
  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-stone-100">Aujourd'hui</h3>
          <p className="text-xs text-gray-400 dark:text-stone-500">Activité du jour</p>
        </div>
        <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400">
          <Package size={11} />{agg.total}
        </span>
      </div>

      <div className="divide-y divide-stone-50 dark:divide-stone-800">
        {TILES.map(t => {
          const Icon = t.icon;
          return (
            <div key={t.key} className="flex items-center justify-between py-1.5">
              <span className="flex items-center gap-2 text-sm text-gray-600 dark:text-stone-300">
                <Icon size={14} className={t.fg} />{t.label}
              </span>
              <span className="font-bold tabular-nums text-gray-900 dark:text-stone-100">{agg[t.key]}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-auto pt-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <TrendingUp size={13} /> Taux de livraison
        </span>
        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{rate(agg)}%</span>
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-52 bg-stone-50 dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 animate-pulse" />
        <div className="lg:col-span-1 h-52 bg-stone-50 dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
      {/* Principale — 7 jours, grand format (2/3 de la largeur) */}
      <div className="lg:col-span-2">
        <HeroCard agg={week} />
      </div>
      {/* Secondaire — aujourd'hui, compacte (1/3) */}
      <div className="lg:col-span-1">
        <CompactCard agg={today} />
      </div>
    </div>
  );
}
