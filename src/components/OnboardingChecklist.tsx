'use client';

// Checklist « premiers pas » affichée sur le dashboard tant que les 3 étapes
// (clé ZRExpress, WhatsApp connecté, première sync) ne sont pas cochées.
// Une fois tout coché → composant renvoie null (disparaît sans stockage).
// Les états sont dérivés des données existantes (aucun localStorage) → si
// l'user reset son numéro, la checklist ne réapparaît PAS (comportement voulu).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Key, MessageSquare, RefreshCw, X } from 'lucide-react';

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
    fetch('/api/onboarding/state')
      .then((r) => r.json())
      .then(setState)
      .catch(() => setState(null));
  }, []);

  if (!state || state.completed || dismissed) return null;

  const doneCount = [
    state.hasZrexpressToken,
    state.hasWhatsappConnected,
    state.hasFirstSync,
  ].filter(Boolean).length;

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

  // Bandeau discret : une seule ligne, la prochaine étape seulement.
  const next = steps.find((st) => !st.done);
  if (!next) return null;
  const NextIcon = next.icon;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-200/70 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/[0.06] px-4 py-3 text-[13.5px]">
      <NextIcon
        size={16}
        strokeWidth={1.75}
        className="text-amber-600 dark:text-amber-400 shrink-0"
      />
      <span className="flex-1 min-w-0 text-amber-900 dark:text-amber-100">
        <span className="font-medium">{next.title}</span>
        <span className="text-amber-800/70 dark:text-amber-200/70"> — {next.desc}</span>
      </span>
      <span className="hidden sm:inline text-[12.5px] tabular-nums text-amber-800/60 dark:text-amber-200/60">
        {doneCount}/3
      </span>
      <Link
        href={next.href}
        className="font-medium text-amber-900 dark:text-amber-100 underline underline-offset-4 decoration-amber-300 dark:decoration-amber-500/50"
      >
        {next.cta}
      </Link>
      <button
        onClick={dismiss}
        aria-label="Masquer"
        className="text-amber-700/50 hover:text-amber-800 dark:text-amber-300/50 dark:hover:text-amber-200"
      >
        <X size={15} />
      </button>
    </div>
  );
}
