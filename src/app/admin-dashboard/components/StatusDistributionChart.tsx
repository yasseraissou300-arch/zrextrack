'use client';

import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { SYNC_DONE_EVENT } from './DashboardHeader';

const STATUS_CONFIG = [
  { key: 'livre',          name: 'Livrées',        color: '#22c55e' },
  { key: 'en_transit',     name: 'En transit',     color: '#3b82f6' },
  { key: 'en_livraison',   name: 'En livraison',   color: '#f59e0b' },
  { key: 'en_preparation', name: 'En préparation', color: '#a78bfa' },
  { key: 'echec',          name: 'Échecs',         color: '#ef4444' },
  { key: 'retourne',       name: 'Retournées',     color: '#94a3b8' },
];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const total = item.payload.total;
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3">
      <div className="flex items-center gap-2 text-sm mb-1">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.payload.color }} />
        <span className="font-medium text-gray-800">{item.name}</span>
      </div>
      <p className="text-lg font-bold tabular-nums text-gray-900">{item.value.toLocaleString('fr-DZ')}</p>
      <p className="text-xs text-gray-400">{total > 0 ? ((item.value / total) * 100).toFixed(1) : 0}% du total</p>
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
    const interval = setInterval(fetch_, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const h = () => fetch_();
    window.addEventListener(SYNC_DONE_EVENT, h);
    return () => window.removeEventListener(SYNC_DONE_EVENT, h);
  }, []);

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 h-full shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-800">Répartition des statuts</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          {loading ? '...' : `${total.toLocaleString('fr-DZ')} commandes au total`}
        </p>
      </div>
      {loading ? (
        <div className="h-[180px] flex items-center justify-center text-gray-300 text-sm">Chargement...</div>
      ) : data.length === 0 ? (
        <div className="h-[180px] flex items-center justify-center text-gray-300 text-sm">Aucune donnée</div>
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
            <span className="flex items-center gap-2 text-gray-500">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%`, backgroundColor: item.color }} />
              </div>
              <span className="tabular-nums font-semibold text-gray-700 w-8 text-right">{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
