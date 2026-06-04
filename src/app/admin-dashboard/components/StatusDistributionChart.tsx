'use client';

import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { SYNC_DONE_EVENT } from './DashboardHeader';

const STATUS_CONFIG = [
  { key: 'livre',          name: 'Livrées',        color: '#22c55e' },
  { key: 'en_transit',     name: 'En transit',     color: '#3b82f6' },
  { key: 'en_livraison',   name: 'En livraison',   color: '#f59e0b' },
  { key: 'en_preparation', name: 'En préparation', color: '#8b5cf6' },
  { key: 'echec',          name: 'Échecs',         color: '#ef4444' },
  { key: 'retourne',       name: 'Retournées',     color: '#94a3b8' },
];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const total = item.payload.total;
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-xl shadow-lg p-3">
      <div className="flex items-center gap-2 text-sm mb-1">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.payload.color }} />
        <span className="font-medium text-gray-800 dark:text-stone-100">{item.name}</span>
      </div>
      <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-stone-100">{item.value.toLocaleString('fr-DZ')}</p>
      <p className="text-xs text-gray-400 dark:text-stone-500">{total > 0 ? ((item.value / total) * 100).toFixed(1) : 0}% du total</p>
    </div>
  );
}

export default function StatusDistributionChart() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = async () => {
    try {
      const res = await fetch('/api/stats');
      const json = await res.json();
      if (json.distribution) {
        const total = Object.values(json.distribution as Record<string, number>).reduce((a, b) => a + b, 0);
        const mapped = STATUS_CONFIG
          .map(s => ({ ...s, value: json.distribution[s.key] ?? 0, total }))
          .filter(s => s.value > 0);
        setData(mapped);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetch_();
    // 60 s + pause onglet inactif (appelle /api/stats — requête lourde).
    const interval = setInterval(() => {
      if (!document.hidden) fetch_();
    }, 60_000);
    const onVisible = () => { if (!document.hidden) fetch_(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const h = () => fetch_();
    window.addEventListener(SYNC_DONE_EVENT, h);
    return () => window.removeEventListener(SYNC_DONE_EVENT, h);
  }, []);

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 p-5 h-full shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-stone-100">Répartition des statuts</h2>
        <p className="text-xs text-gray-400 dark:text-stone-500 mt-0.5">
          {loading ? '...' : `${total.toLocaleString('fr-DZ')} commandes au total`}
        </p>
      </div>
      {loading ? (
        <div className="h-[180px] flex items-center justify-center text-gray-300 dark:text-stone-600 text-sm">Chargement...</div>
      ) : data.length === 0 ? (
        <div className="h-[180px] flex items-center justify-center text-gray-300 dark:text-stone-600 text-sm">Aucune donnée</div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value">
              {data.map((entry) => <Cell key={entry.key} fill={entry.color} stroke="none" />)}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      )}
      <div className="space-y-2 mt-3">
        {data.map((item) => (
          <div key={item.key} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-gray-500 dark:text-stone-400">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%`, backgroundColor: item.color }} />
              </div>
              <span className="tabular-nums font-semibold text-gray-700 dark:text-stone-200 w-8 text-right">{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
