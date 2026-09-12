'use client';

// Composants UI partagés — SOURCE UNIQUE du langage visuel de l'app.
// Avant, chaque page redéfinissait ses badges de statut, ses cartes de stats
// et ses en-têtes → couleurs incohérentes + mode sombre oublié par endroits.
// Tout passe désormais par ces primitives (dark mode inclus partout).

import React from 'react';
import type { LucideIcon } from 'lucide-react';

// ── Tons colorés réutilisables (pastilles d'icônes) — avec variante sombre ───
export type Tone = 'violet' | 'amber' | 'green' | 'red' | 'blue' | 'indigo' | 'stone' | 'fuchsia';

const TONE_CLS: Record<Tone, string> = {
  violet: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  green: 'bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300',
  red: 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  indigo: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  stone: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
  fuchsia: 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
};

// ── Statuts de livraison — LE référentiel unique (label + couleurs) ──────────
const STATUS: Record<string, { label: string; cls: string }> = {
  en_preparation: {
    label: 'En préparation',
    cls: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  },
  en_transit: {
    label: 'En transit',
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  },
  en_livraison: {
    label: 'En livraison',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  livre: {
    label: 'Livré',
    cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  },
  echec: { label: 'Échec', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  retourne: {
    label: 'Retourné',
    cls: 'bg-stone-100 text-stone-600 dark:bg-stone-700/50 dark:text-stone-300',
  },
};

export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? (status || '—');
}

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const s = STATUS[status] ?? {
    label: status || '—',
    cls: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
  };
  return (
    <span
      className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ${s.cls} ${className}`}
    >
      {s.label}
    </span>
  );
}

// ── En-tête de page uniforme (icône colorée + titre + sous-titre + action) ───
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  tone = 'violet',
  action,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  tone?: Tone;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${TONE_CLS[tone]}`}
        >
          <Icon size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">{title}</h1>
          {subtitle && <p className="text-sm text-stone-500 dark:text-stone-400">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ── Carte de statistique uniforme ────────────────────────────────────────────
export function StatCard({
  icon: Icon,
  label,
  value,
  tone = 'violet',
  loading = false,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  loading?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl p-4 shadow-sm border border-stone-100 dark:border-stone-800">
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 ${TONE_CLS[tone]}`}
      >
        <Icon size={16} />
      </div>
      <p className="text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
        {loading ? <span className="text-stone-300 dark:text-stone-700">—</span> : value}
      </p>
      <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">{label}</p>
    </div>
  );
}

// ── État vide illustré (icône + message + action) ────────────────────────────
export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center mb-3">
        <Icon size={24} className="text-stone-400 dark:text-stone-500" />
      </div>
      <p className="font-medium text-stone-700 dark:text-stone-200">{title}</p>
      {subtitle && (
        <p className="text-sm text-stone-400 dark:text-stone-500 mt-1 max-w-sm">{subtitle}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
