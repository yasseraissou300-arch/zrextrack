'use client';

// Avis des clients après livraison (réponse WhatsApp 1 / 2 / 3), 90 jours.

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';

interface Ratings {
  total: number;
  excellent: number;
  correct: number;
  bad: number;
}

const ROWS: { key: keyof Omit<Ratings, 'total'>; label: string; bar: string }[] = [
  { key: 'excellent', label: 'Excellent ⭐', bar: 'bg-emerald-500' },
  { key: 'correct', label: 'Correct 👌', bar: 'bg-amber-400' },
  { key: 'bad', label: 'Pas satisfait 👎', bar: 'bg-rose-500' },
];

export default function RatingsCard() {
  const [r, setR] = useState<Ratings | null>(null);

  useEffect(() => {
    fetch('/api/inbox/requests')
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => setR(j?.ratings ?? null))
      .catch(() => {});
  }, []);

  if (!r) return null;
  const pct = (n: number) => (r.total ? Math.round((n / r.total) * 100) : 0);

  return (
    <div className="card-soft bg-white dark:bg-stone-900 p-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl grid place-items-center bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
          <Star size={19} />
        </div>
        <div>
          <h2 className="font-bold text-indigo-950 dark:text-stone-100">Avis des clients</h2>
          <p className="text-[13px] text-stone-500 dark:text-stone-400">
            Réponses WhatsApp après livraison — 90 derniers jours ({r.total} avis)
          </p>
        </div>
      </div>
      {r.total === 0 ? (
        <p className="mt-4 text-[13px] text-stone-500 dark:text-stone-400">
          Aucun avis pour l’instant : la question « واش رايك في المنتوج ؟ » part avec la
          notification « livré ».
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {ROWS.map((row) => (
            <div key={row.key}>
              <div className="flex justify-between text-[13px] font-semibold text-stone-700 dark:text-stone-200">
                <span>{row.label}</span>
                <span className="tabular-nums">
                  {r[row.key]} · {pct(r[row.key])} %
                </span>
              </div>
              <div className="mt-1 h-2.5 rounded-full bg-violet-100/70 dark:bg-white/[0.06] overflow-hidden">
                <div
                  className={`h-full rounded-full ${row.bar}`}
                  style={{ width: `${pct(r[row.key])}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
