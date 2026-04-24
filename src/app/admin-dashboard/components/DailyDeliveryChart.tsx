'use client';

import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,  } from 'recharts';

const data = [
  { day: '22/03', livrees: 72, echecs: 8, retours: 3 },
  { day: '23/03', livrees: 58, echecs: 12, retours: 5 },
  { day: '24/03', livrees: 91, echecs: 6, retours: 2 },
  { day: '25/03', livrees: 65, echecs: 15, retours: 7 },
  { day: '26/03', livrees: 88, echecs: 9, retours: 4 },
  { day: '27/03', livrees: 103, echecs: 11, retours: 6 },
  { day: '28/03', livrees: 84, echecs: 7, retours: 3 },
];

interface TooltipPayload {
  color: string;
  name: string;
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg p-3 min-w-[160px]">
      <p className="text-xs font-600 text-[hsl(var(--muted-foreground))] mb-2 uppercase tracking-wide">
        {label}
      </p>
      {payload.map((entry) => (
        <div key={`tip-${entry.name}`} className="flex items-center justify-between gap-4 text-xs mb-1">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[hsl(var(--muted-foreground))]">{entry.name}</span>
          </span>
          <span className="font-semibold tabular-nums text-[hsl(var(--foreground))]">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function DailyDeliveryChart() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[15px] font-600 text-[hsl(var(--foreground))]">Livraisons journalières</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">7 derniers jours — ZREXpress</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#16a34a]" />
            Livrées
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#f59e0b]" />
            Échecs
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#e5e7eb]" />
            Retours
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barSize={16} barGap={3}>
          <CartesianGrid vertical={false} stroke="hsl(220,13%,91%)" strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: 'hsl(220,9%,46%)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(220,9%,46%)' }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(220,13%,97%)' }} />
          <Bar dataKey="livrees" name="Livrées" fill="#16a34a" radius={[3, 3, 0, 0]} />
          <Bar dataKey="echecs" name="Échecs" fill="#f59e0b" radius={[3, 3, 0, 0]} />
          <Bar dataKey="retours" name="Retours" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}