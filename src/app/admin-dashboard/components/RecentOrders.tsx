'use client';

// Accueil (refonte) : les 5 dernières commandes, version épurée.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SYNC_DONE_EVENT } from './DashboardHeader';
import { formatDA, prettyProduct, statusBadge } from '@/lib/ui/order-display';

// Pastille colorée avec l'initiale du client (couleur stable par ligne).
const AVATAR = [
  'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
];

interface Row {
  id: string;
  customer_name: string | null;
  product_name: string | null;
  delivery_status: string | null;
  cod: number | null;
}

export default function RecentOrders() {
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/orders?page=1&pageSize=5');
      const j = r.ok ? await r.json() : null;
      if (Array.isArray(j?.data)) setRows(j.data);
    } catch {
      /* non bloquant */
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(SYNC_DONE_EVENT, load);
    return () => window.removeEventListener(SYNC_DONE_EVENT, load);
  }, [load]);

  return (
    <section className="card-soft bg-white dark:bg-stone-900">
      <div className="px-6 pt-5 pb-3 flex items-baseline justify-between">
        <h2 className="text-[17px] font-extrabold text-indigo-950 dark:text-stone-50">
          Dernières commandes
        </h2>
        <Link
          href="/commandes"
          className="text-[14px] font-bold text-violet-600 hover:text-violet-800 dark:text-violet-300"
        >
          Tout voir →
        </Link>
      </div>
      {rows === null ? (
        <div className="px-6 pb-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded bg-stone-100 dark:bg-stone-800 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-6 pb-6 text-[14px] text-stone-400">
          Aucune commande pour l’instant. Lancez une synchronisation ZRExpress.
        </p>
      ) : (
        <ul className="text-[14px]">
          {rows.map((o, i) => {
            const p = prettyProduct(o.product_name);
            const b = statusBadge(o.delivery_status);
            return (
              <li
                key={o.id}
                className="flex items-center gap-4 px-6 py-3 border-t border-stone-100 dark:border-stone-800"
              >
                <div
                  className={`w-9 h-9 rounded-xl grid place-items-center text-[13px] font-extrabold shrink-0 ${AVATAR[i % AVATAR.length]}`}
                >
                  {(o.customer_name || '?').trim().charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-indigo-950 dark:text-stone-100 truncate">
                    <bdi>{o.customer_name || '—'}</bdi>
                  </div>
                  <div className="text-[12.5px] text-stone-400 truncate">
                    {p.name}
                    {p.variant && ` · ${p.variant}`}
                  </div>
                </div>
                <span
                  className={`text-[12px] font-bold px-2.5 py-1 rounded-full shrink-0 ${b.className}`}
                >
                  {b.label}
                </span>
                <span className="w-24 text-right tabular-nums font-extrabold text-indigo-950 dark:text-stone-100 shrink-0">
                  {formatDA(o.cod)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
