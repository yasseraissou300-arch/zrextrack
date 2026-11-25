'use client';

// Taux de retour par wilaya (refus ÷ colis terminés) — barres colorées :
// vert < 30 %, ambre 30-50 %, rouge > 50 %. Les wilayas avec moins de 10
// colis terminés sont écartées (pourcentage peu fiable).

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GroupStat } from '@/lib/reports/aggregate';

const MIN_DONE = 10;

export function retourRows(wilayas: GroupStat[], max = 12) {
  return wilayas
    .filter((w) => w.livre + w.refus >= MIN_DONE)
    .map((w) => ({
      name: w.name,
      retour: Math.round((w.refus / (w.livre + w.refus)) * 100),
      refus: w.refus,
      termine: w.livre + w.refus,
    }))
    .sort((a, b) => b.retour - a.retour)
    .slice(0, max);
}

const color = (pct: number) => (pct > 50 ? '#e11d48' : pct >= 30 ? '#f59e0b' : '#10b981');

function Tip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as ReturnType<typeof retourRows>[number];
  return (
    <div className="rounded-xl bg-white dark:bg-stone-800 px-3 py-2 shadow-lg text-[12.5px]">
      <p className="font-bold text-indigo-950 dark:text-stone-50">{d.name}</p>
      <p className="text-stone-600 dark:text-stone-300">
        {d.retour} % de retour · {d.refus} / {d.termine} colis
      </p>
    </div>
  );
}

export default function RetourByWilayaChart({
  wilayas,
  loading,
}: {
  wilayas: GroupStat[];
  loading: boolean;
}) {
  const rows = retourRows(wilayas);
  return (
    <div className="card-soft bg-white dark:bg-stone-900 p-6">
      <h2 className="font-bold text-indigo-950 dark:text-stone-100">Retours par wilaya</h2>
      <p className="text-[13px] text-stone-500 dark:text-stone-400">
        Part des colis refusés ou retournés — les wilayas les plus risquées en premier
      </p>
      {loading ? (
        <div className="h-64 mt-4 rounded-xl bg-stone-100 dark:bg-stone-800 animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="mt-4 text-[13px] text-stone-400">Pas encore assez de colis terminés.</p>
      ) : (
        <div className="h-72 mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: '#78716c' }}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#78716c' }}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip content={<Tip />} cursor={{ fill: 'rgba(124,58,237,0.06)' }} />
              <Bar dataKey="retour" radius={[8, 8, 0, 0]}>
                {rows.map((r) => (
                  <Cell key={r.name} fill={color(r.retour)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
