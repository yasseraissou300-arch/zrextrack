'use client';

// Accueil (refonte) : chiffres clés, courbe des livraisons et « À faire ».
// Une seule série de requêtes pour les trois blocs (même cadence que
// l'ancien KPIBentoGrid : 60 s, onglet visible seulement, + après chaque sync).

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { SYNC_DONE_EVENT } from './DashboardHeader';

interface Kpis {
  totalOrders: number;
  delivered: number;
  inTransit: number;
  enPreparation: number;
}
interface Agg {
  livrees: number;
  echecs: number;
  retours: number;
  en_cours: number;
  total: number;
}
interface Day {
  day: string;
  livrees: number;
  echecs: number;
  retours: number;
}

const POLL_INTERVAL = 60_000;
const EMPTY: Agg = { livrees: 0, echecs: 0, retours: 0, en_cours: 0, total: 0 };
const fmt = (n: number | undefined) => (n ?? 0).toLocaleString('fr-FR');

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as Day;
  return (
    <div className="rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3 py-2 text-[12.5px] shadow-sm">
      <div className="text-stone-400 mb-1">{label}</div>
      <div className="text-stone-900 dark:text-stone-100">
        <span className="font-medium tabular-nums">{d.livrees}</span> livrées
      </div>
      <div className="text-stone-500">
        <span className="tabular-nums">{d.echecs}</span> échecs ·{' '}
        <span className="tabular-nums">{d.retours}</span> retours
      </div>
    </div>
  );
}

export default function HomeOverview({ children }: { children?: React.ReactNode }) {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [today, setToday] = useState<Agg>(EMPTY);
  const [daily, setDaily] = useState<Day[]>([]);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const [k, s, w] = await Promise.all([
        fetch('/api/kpis').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/stats', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/whatsapp/status').then((r) => (r.ok ? r.json() : null)),
      ]);
      if (k && !k.error) setKpis(k);
      if (s?.today) setToday(s.today);
      if (Array.isArray(s?.daily)) setDaily(s.daily);
      if (w) setWaConnected(!!w.connected);
    } catch {
      /* bloc non bloquant : on garde les dernières valeurs */
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(SYNC_DONE_EVENT, load);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(SYNC_DONE_EVENT, load);
    };
  }, [load]);

  const finalized = today.livrees + today.echecs + today.retours;
  const todayRate = finalized > 0 ? Math.round((today.livrees / finalized) * 100) : null;
  const enCours = (kpis?.enPreparation ?? 0) + (kpis?.inTransit ?? 0);

  const stats = [
    {
      label: 'Commandes',
      value: fmt(kpis?.totalOrders),
      sub: `${fmt(today.total)} mises à jour aujourd’hui`,
      tone: 'muted',
    },
    {
      label: 'Livrées',
      value: fmt(kpis?.delivered),
      sub: `+${fmt(today.livrees)} aujourd’hui`,
      tone: today.livrees > 0 ? 'good' : 'muted',
    },
    {
      label: 'Taux de livraison',
      value: todayRate === null ? '—' : `${todayRate} %`,
      sub:
        finalized > 0
          ? `${today.livrees} sur ${finalized} aujourd’hui`
          : 'Aucune livraison finalisée aujourd’hui',
      tone: 'muted',
    },
    {
      label: 'En cours',
      value: fmt(enCours),
      sub: `${fmt(kpis?.inTransit)} en route`,
      tone: 'muted',
    },
  ];

  const todo: { dot: string; label: string; href: string }[] = [];
  if (waConnected === false)
    todo.push({
      dot: 'bg-amber-500',
      label: 'WhatsApp déconnecté',
      href: '/messages?tab=connexion',
    });
  if (today.echecs > 0)
    todo.push({
      dot: 'bg-rose-500',
      label: `${fmt(today.echecs)} livraison${today.echecs > 1 ? 's' : ''} en échec aujourd’hui`,
      href: '/alertes',
    });
  if (today.retours > 0)
    todo.push({
      dot: 'bg-stone-400',
      label: `${fmt(today.retours)} retour${today.retours > 1 ? 's' : ''} aujourd’hui`,
      href: '/livraisons',
    });
  if ((kpis?.enPreparation ?? 0) > 0)
    todo.push({
      dot: 'bg-violet-500',
      label: `${fmt(kpis?.enPreparation)} commandes en préparation`,
      href: '/commandes',
    });

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 rounded-xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 divide-x divide-y lg:divide-y-0 divide-stone-100 dark:divide-stone-800">
        {stats.map((s) => (
          <div key={s.label} className="p-6">
            <div className="text-[13px] text-stone-500 dark:text-stone-400">{s.label}</div>
            <div className="mt-2 text-[30px] leading-none font-semibold tracking-tight tabular-nums text-stone-900 dark:text-stone-50">
              {kpis ? (
                s.value
              ) : (
                <span className="inline-block w-20 h-7 rounded bg-stone-100 dark:bg-stone-800 animate-pulse" />
              )}
            </div>
            <div
              className={`mt-2 text-[12.5px] ${
                s.tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400'
              }`}
            >
              {s.sub}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold text-stone-900 dark:text-stone-50">
            Livraisons
          </h2>
          <span className="text-[13px] text-stone-400">7 derniers jours</span>
        </div>
        <div className="h-[220px] mt-4 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="homeArea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#a8a29e' }}
                dy={8}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#e7e5e4' }} />
              <Area
                type="monotone"
                dataKey="livrees"
                stroke="#7c3aed"
                strokeWidth={2.25}
                fill="url(#homeArea)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section className="lg:col-span-2 rounded-xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 self-start">
          <h2 className="px-6 pt-5 pb-3 text-[15px] font-semibold text-stone-900 dark:text-stone-50">
            À faire
          </h2>
          {todo.length === 0 ? (
            <p className="px-6 pb-6 text-[14px] text-stone-400">Rien d’urgent pour le moment.</p>
          ) : (
            <ul className="text-[14px]">
              {todo.map((t) => (
                <li key={t.label} className="border-t border-stone-100 dark:border-stone-800">
                  <Link
                    href={t.href}
                    className="flex items-center gap-3 px-6 py-3.5 text-stone-800 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.dot}`} />
                    <span className="flex-1">{t.label}</span>
                    <ChevronRight size={16} className="text-stone-300 dark:text-stone-600" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="lg:col-span-3">{children}</div>
      </div>
    </>
  );
}
