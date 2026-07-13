'use client';

// Checklist « premiers pas » affichée sur le dashboard tant que les 3 étapes
// (clé ZRExpress, WhatsApp connecté, première sync) ne sont pas cochées.
// Une fois tout coché → composant renvoie null (disparaît sans stockage).
// Les états sont dérivés des données existantes (aucun localStorage) → si
// l'user reset son numéro, la checklist ne réapparaît PAS (comportement voulu).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Key, MessageSquare, RefreshCw, Sparkles, X } from 'lucide-react';

interface State {
  hasZrexpressToken: boolean;
  hasWhatsappConnected: boolean;
  hasFirstSync: boolean;
  completed: boolean;
}

const DISMISS_KEY = 'autotim-onboarding-dismissed';

export default function OnboardingChecklist() {
  const [state, setState] = useState<State | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Permet à l'user de la cacher même si tout n'est pas coché (bouton ✕).
    if (typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1') {
      setDismissed(true);
    }
    fetch('/api/onboarding/state').then(r => r.json()).then(setState).catch(() => setState(null));
  }, []);

  if (!state || state.completed || dismissed) return null;

  const doneCount = [state.hasZrexpressToken, state.hasWhatsappConnected, state.hasFirstSync].filter(Boolean).length;
  const pct = Math.round((doneCount / 3) * 100);

  const steps = [
    {
      done: state.hasZrexpressToken,
      icon: Key,
      title: 'Connectez ZRExpress',
      desc: 'Collez votre clé API + tenant ID une seule fois.',
      cta: 'Configurer',
      href: '/sync',
    },
    {
      done: state.hasWhatsappConnected,
      icon: MessageSquare,
      title: 'Connectez WhatsApp',
      desc: 'Scannez le QR code depuis votre téléphone.',
      cta: 'Connecter',
      href: '/messages?tab=connexion',
    },
    {
      done: state.hasFirstSync,
      icon: RefreshCw,
      title: 'Lancez votre première sync',
      desc: 'Autotim récupère vos commandes ZRExpress.',
      cta: 'Synchroniser',
      href: '/sync',
    },
  ];

  const dismiss = () => {
    if (typeof window !== 'undefined') localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="relative bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-500/10 dark:to-fuchsia-500/10 border border-violet-200 dark:border-violet-500/30 rounded-2xl p-5 shadow-sm">
      <button
        onClick={dismiss}
        aria-label="Masquer"
        className="absolute top-3 right-3 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
      >
        <X size={16} />
      </button>

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-sm shadow-violet-500/25">
          <Sparkles size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-stone-900 dark:text-stone-100">Bienvenue sur Autotim</h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">3 étapes pour commencer — moins de 5 minutes.</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-violet-600 dark:text-violet-300 tabular-nums">{doneCount}/3</div>
          <div className="text-[10px] text-stone-500 dark:text-stone-400 uppercase font-semibold tracking-wide">Progrès</div>
        </div>
      </div>

      {/* Barre de progression */}
      <div className="h-1.5 bg-white/50 dark:bg-stone-800 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid gap-2">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <Link
              key={i}
              href={step.href}
              className={`flex items-center gap-3 p-3 rounded-xl transition-colors border ${
                step.done
                  ? 'bg-white/60 dark:bg-stone-900/60 border-transparent'
                  : 'bg-white dark:bg-stone-900 border-stone-100 dark:border-stone-800 hover:border-violet-300 dark:hover:border-violet-500/50'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                step.done
                  ? 'bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-300'
                  : 'bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-300'
              }`}>
                {step.done ? <CheckCircle2 size={16} /> : <Icon size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${step.done ? 'text-stone-400 dark:text-stone-500 line-through' : 'text-stone-900 dark:text-stone-100'}`}>
                  {step.title}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">{step.desc}</p>
              </div>
              {step.done ? (
                <Circle size={14} className="text-green-500 fill-green-500" />
              ) : (
                <span className="text-xs font-semibold text-violet-600 dark:text-violet-300">{step.cta} →</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
