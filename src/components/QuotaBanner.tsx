'use client';

// Bandeau de quota mensuel — visible sur le dashboard :
//   - masqué si l'user est illimité (Business/Admin)
//   - discret tant que < 80% (juste "X / Y ce mois")
//   - alerte ambre entre 80% et 99%
//   - bloc rouge à 100% avec CTA upgrade (mailto Yasser)

import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, Mail } from 'lucide-react';

interface QuotaState {
  planId: string;
  planLabel: string;
  quota: number | null;
  used: number;
  remaining: number | null;
  percent: number;
  isOver: boolean;
  isNear: boolean;
  isUnlimited: boolean;
}

const UPGRADE_MAILTO = 'mailto:yasseraissou300@gmail.com?subject=Autotim%20%E2%80%94%20Upgrade%20de%20plan&body=Bonjour%20Yasser%2C%0A%0AJe%20souhaite%20passer%20mon%20plan%20Autotim%20%C3%A0%20un%20niveau%20sup%C3%A9rieur%20(mon%20quota%20est%20atteint).%0A%0AMerci.';

export default function QuotaBanner() {
  const [state, setState] = useState<QuotaState | null>(null);

  useEffect(() => {
    fetch('/api/quotas/state').then(r => r.json()).then(setState).catch(() => setState(null));
  }, []);

  if (!state || state.isUnlimited) return null;

  // Sous 80% → petit indicateur discret sans fond agressif.
  if (!state.isNear && !state.isOver) {
    return (
      <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-stone-400 px-3">
        <span className="tabular-nums">
          Ce mois : <strong className="text-stone-700 dark:text-stone-200">{state.used}</strong> / {state.quota} commandes ({state.planLabel})
        </span>
        <div className="flex-1 max-w-xs h-1 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
          <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${state.percent}%` }} />
        </div>
      </div>
    );
  }

  const isOver = state.isOver;
  const tone = isOver
    ? 'from-red-50 to-red-50 dark:from-red-500/10 dark:to-red-500/10 border-red-200 dark:border-red-500/30'
    : 'from-amber-50 to-amber-50 dark:from-amber-500/10 dark:to-amber-500/10 border-amber-200 dark:border-amber-500/30';
  const iconBg = isOver ? 'bg-red-500 text-white' : 'bg-amber-500 text-white';
  const barColor = isOver ? 'bg-red-500' : 'bg-amber-500';
  const Icon = isOver ? AlertTriangle : TrendingUp;

  return (
    <div className={`bg-gradient-to-br ${tone} border rounded-2xl p-5`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-stone-900 dark:text-stone-100">
            {isOver
              ? 'Quota mensuel atteint'
              : `Plus que ${state.remaining} commandes ce mois`}
          </h3>
          <p className="text-sm text-stone-600 dark:text-stone-300 mt-0.5">
            {isOver ? (
              <>Votre plan {state.planLabel} est limité à {state.quota} commandes/mois. Les prochaines syncs seront bloquées jusqu'au 1er du mois prochain.</>
            ) : (
              <>Vous êtes à {state.percent}% de votre quota mensuel {state.planLabel}. Pensez à passer au plan supérieur pour éviter le blocage.</>
            )}
          </p>

          <div className="mt-3 h-2 bg-white/60 dark:bg-stone-900/40 rounded-full overflow-hidden">
            <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${state.percent}%` }} />
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 tabular-nums">
            {state.used} / {state.quota} commandes
          </p>

          <a
            href={UPGRADE_MAILTO}
            className="mt-4 inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
          >
            <Mail size={14} /> Passer au plan supérieur
          </a>
        </div>
      </div>
    </div>
  );
}
