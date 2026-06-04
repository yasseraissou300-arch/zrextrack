'use client';

import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SYNC_DONE_EVENT } from './DashboardHeader';

interface DayData { day: string; livrees: number; echecs: number; retours: number; }

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-xl shadow-lg p-3 min-w-[150px]">
      <p className="text-xs font-semibold text-gray-400 dark:text-stone-500 mb-2 uppercase tracking-wide">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 text-xs mb-1">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-500 dark:text-stone-400">{entry.name}</span>
          </span>
          <span className="font-bold tabular-nums text-gray-800 dark:text-stone-100">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function DailyDeliveryChart() {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = async () => {
    try {
      const res = await fetch('/api/stats');
      const json = await res.json();
      if (json.daily) setData(json.daily);
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

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-stone-100">Livraisons journalières</h2>
          <p className="text-xs text-gray-400 dark:text-stone-500 mt-0.5">7 derniers jours</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-stone-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-500" />Livrées</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />Échecs</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300" />Retours</span>
        </div>
      </div>
      {loading ? (
        <div className="h-[220px] flex items-center justify-center text-gray-300 dark:text-stone-600 text-sm">Chargement...</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} barSize={14} barGap={2}>
            <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="livrees" name="Livrées" fill="#22c55e" radius={[3, 3, 0, 0]} />
            <Bar dataKey="echecs"  name="Échecs"  fill="#f59e0b" radius={[3, 3, 0, 0]} />
            <Bar dataKey="retours" name="Retours" fill="#d1d5db" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
