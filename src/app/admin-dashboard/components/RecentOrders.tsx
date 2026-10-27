'use client';

// Accueil (refonte) : les 5 dernières commandes, version épurée.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SYNC_DONE_EVENT } from './DashboardHeader';
import { formatDA, prettyProduct, statusBadge } from '@/lib/ui/order-display';

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
    <section className="rounded-xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900">
      <div className="px-6 pt-5 pb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-stone-900 dark:text-stone-50">
          Dernières commandes
        </h2>
        <Link
          href="/commandes"
          className="text-[13px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
        >
          Tout voir
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
          {rows.map((o) => {
            const p = prettyProduct(o.product_name);
            const b = statusBadge(o.delivery_status);
            return (
              <li
                key={o.id}
                className="flex items-center gap-4 px-6 py-3 border-t border-stone-100 dark:border-stone-800"
              >
                <div className="flex-1 min-w-0">
                  <div
                    className="font-medium text-stone-900 dark:text-stone-100 truncate"
                    dir="auto"
                  >
                    {o.customer_name || '—'}
                  </div>
                  <div className="text-[12.5px] text-stone-400 truncate">
                    {p.name}
                    {p.variant && ` · ${p.variant}`}
                  </div>
                </div>
                <span
                  className={`text-[12px] font-medium px-2 py-0.5 rounded shrink-0 ${b.className}`}
                >
                  {b.label}
                </span>
                <span className="w-24 text-right tabular-nums text-stone-900 dark:text-stone-100 shrink-0">
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
