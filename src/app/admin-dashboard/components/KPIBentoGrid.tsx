'use client';

import React from 'react';
import {
  Package,
  CheckCircle2,
  Truck,
  TrendingUp,
  MessageSquare,
  RotateCcw,
} from 'lucide-react';
import Icon from '@/components/ui/AppIcon';


// Grid plan: 6 cards → grid-cols-2 md:grid-cols-3 xl:grid-cols-6
// Row 1: hero (total commandes, spans 2 cols) + 2 regular → 4 cols used on xl
// Actually: 6 cards → xl:grid-cols-3 × 2 rows = clean 3×2
// Final: grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 with hero spanning 2

const kpis = [
  {
    id: 'kpi-total',
    label: 'Total Commandes',
    value: '1 247',
    sub: '+38 cette semaine',
    trend: 'up',
    icon: Package,
    color: 'blue',
    span: 2,
  },
  {
    id: 'kpi-delivered',
    label: 'Livrées aujourd\'hui',
    value: '84',
    sub: 'sur 97 attendues',
    trend: 'up',
    icon: CheckCircle2,
    color: 'green',
    span: 1,
  },
  {
    id: 'kpi-transit',
    label: 'En transit',
    value: '312',
    sub: '14 en retard',
    trend: 'warning',
    icon: Truck,
    color: 'amber',
    span: 1,
  },
  {
    id: 'kpi-rate',
    label: 'Taux de livraison',
    value: '87.4%',
    sub: '−2.1% vs mois dernier',
    trend: 'down',
    icon: TrendingUp,
    color: 'red',
    span: 1,
  },
  {
    id: 'kpi-whatsapp',
    label: 'Messages envoyés',
    value: '3 891',
    sub: '156 aujourd\'hui',
    trend: 'up',
    icon: MessageSquare,
    color: 'green',
    span: 1,
  },
  {
    id: 'kpi-returns',
    label: 'Retours / Échecs',
    value: '47',
    sub: '↑ 8 cette semaine',
    trend: 'alert',
    icon: RotateCcw,
    color: 'red',
    span: 1,
  },
];

const colorMap: Record<string, { bg: string; icon: string; badge: string; border: string }> = {
  blue: {
    bg: 'bg-blue-50',
    icon: 'text-blue-600',
    badge: 'bg-blue-100 text-blue-700',
    border: 'border-blue-100',
  },
  green: {
    bg: 'bg-green-50',
    icon: 'text-green-600',
    badge: 'bg-green-100 text-green-700',
    border: 'border-green-100',
  },
  amber: {
    bg: 'bg-amber-50',
    icon: 'text-amber-600',
    badge: 'bg-amber-100 text-amber-700',
    border: 'border-amber-100',
  },
  red: {
    bg: 'bg-red-50',
    icon: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
    border: 'border-red-100',
  },
};

const trendStyle: Record<string, string> = {
  up: 'text-green-600',
  down: 'text-red-500',
  warning: 'text-amber-600',
  alert: 'text-red-600 font-semibold',
};

export default function KPIBentoGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        const colors = colorMap[kpi.color];
        return (
          <div
            key={kpi.id}
            className={`bg-white rounded-xl border border-[hsl(var(--border))] p-5 flex flex-col gap-3 hover:shadow-md transition-shadow duration-200 ${
              kpi.span === 2 ? 'xl:col-span-2' : 'xl:col-span-1'
            } ${kpi.trend === 'alert' ? 'border-red-200 bg-red-50/30' : ''}`}
          >
            <div className="flex items-start justify-between">
              <div className={`w-9 h-9 rounded-lg ${colors.bg} flex items-center justify-center`}>
                <Icon size={18} className={colors.icon} />
              </div>
              {kpi.trend === 'alert' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 uppercase tracking-wide">
                  Alerte
                </span>
              )}
            </div>
            <div>
              <p className="text-[12px] font-500 text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-0.5">
                {kpi.label}
              </p>
              <p className="text-3xl font-bold tabular-nums text-[hsl(var(--foreground))] leading-none">
                {kpi.value}
              </p>
            </div>
            <p className={`text-xs font-medium ${trendStyle[kpi.trend]}`}>
              {kpi.sub}
            </p>
          </div>
        );
      })}
    </div>
  );
}