'use client';

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const data = [
  { name: 'Livrées', value: 847, color: '#16a34a' },
  { name: 'En transit', value: 312, color: '#3b82f6' },
  { name: 'En préparation', value: 89, color: '#a78bfa' },
  { name: 'Échec livraison', value: 47, color: '#f59e0b' },
  { name: 'Retournées', value: 23, color: '#ef4444' },
];

const total = data.reduce((s, d) => s + d.value, 0);

interface TooltipPayload {
  name: string;
  value: number;
  payload: { color: string };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0];
  return (
    <div className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg p-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.payload.color }} />
        <span className="font-medium text-[hsl(var(--foreground))]">{item.name}</span>
      </div>
      <p className="text-lg font-bold tabular-nums text-[hsl(var(--foreground))] mt-1">
        {item.value.toLocaleString('fr-DZ')}
      </p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        {((item.value / total) * 100).toFixed(1)}% du total
      </p>
    </div>
  );
}

export default function StatusDistributionChart() {
  return (
    <div className="bg-white rounded-xl border border-[hsl(var(--border))] p-5 h-full">
      <div className="mb-4">
        <h2 className="text-[15px] font-600 text-[hsl(var(--foreground))]">Répartition des statuts</h2>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{total.toLocaleString('fr-DZ')} commandes au total</p>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry) => (
              <Cell key={`cell-${entry.name}`} fill={entry.color} stroke="none" />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-2 mt-3">
        {data.map((item) => (
          <div key={`legend-${item.name}`} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 bg-[hsl(var(--secondary))] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(item.value / total) * 100}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
              <span className="tabular-nums font-medium text-[hsl(var(--foreground))] w-8 text-right">
                {item.value}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}