'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, CheckCheck, Trash2, Wand2, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { SYNC_DONE_EVENT } from './DashboardHeader';
import OrderDetailModal from './OrderDetailModal';
import { formatDA, prettyProduct, statusBadge } from '@/lib/ui/order-display';

type Status = 'en_preparation' | 'en_transit' | 'en_livraison' | 'livre' | 'echec' | 'retourne';

interface Order {
  id: string;
  tracking_number: string;
  customer_name: string;
  customer_whatsapp: string;
  product_name: string;
  wilaya: string;
  district: string;
  delivery_status: Status;
  situation: string;
  delivery_type: string;
  delivery_fees: number;
  last_update: string;
  attempts: number;
  cod: number;
}

const TABS = [
  { key: 'all', label: 'Toutes' },
  { key: 'en_cours', label: 'En cours' },
  { key: 'livre', label: 'Livrées' },
  { key: 'echec', label: 'Échecs' },
  { key: 'retourne', label: 'Retours' },
];

// Était 5 s → une requête /api/orders (+ COUNT pagination) toutes les 5 s.
// Passé à 60 s + pause onglet inactif pour soulager la base.
const POLL_INTERVAL = 60_000;

export default function OrdersTable() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [reclassifying, setReclassifying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  // Compteurs des onglets : une requête /api/stats (répartition), rafraîchie
  // après chaque sync.
  const fetchCounts = useCallback(async () => {
    try {
      const r = await fetch('/api/stats', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (j?.distribution) setCounts(j.distribution);
    } catch {
      /* compteurs facultatifs */
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    window.addEventListener(SYNC_DONE_EVENT, fetchCounts);
    return () => window.removeEventListener(SYNC_DONE_EVENT, fetchCounts);
  }, [fetchCounts]);

  const fetchOrders = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          status: statusFilter,
          search,
        });
        const res = await fetch(`/api/orders?${params}`);
        const json = await res.json();
        if (json.error) {
          if (!silent) toast.error(json.error);
        } else {
          setOrders(json.data || []);
          setTotal(json.count || 0);
          setLastRefresh(new Date().toLocaleTimeString('fr-FR'));
          setSelected(new Set()); // reset sélection après refresh
        }
      } catch (err: any) {
        if (!silent) toast.error(err.message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, statusFilter, search, pageSize]
  );

  // Polling silencieux — uniquement quand l'onglet est visible.
  useEffect(() => {
    fetchOrders();
    const interval = setInterval(() => {
      if (!document.hidden) fetchOrders(true);
    }, POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) fetchOrders(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchOrders]);

  // Rafraîchir immédiatement après un sync ZREXpress
  useEffect(() => {
    const handler = () => fetchOrders(true);
    window.addEventListener(SYNC_DONE_EVENT, handler);
    return () => window.removeEventListener(SYNC_DONE_EVENT, handler);
  }, [fetchOrders]);

  const copyTracking = (tracking: string) => {
    navigator.clipboard.writeText(tracking);
    setCopiedId(tracking);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Tracking copié !');
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === orders.length && orders.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map((o) => o.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Déplacer ${selected.size} commande(s) vers la corbeille ?`)) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/orders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const json = await res.json();
      if (json.error) {
        toast.error(json.error);
      } else {
        toast.success(`${selected.size} commande(s) déplacée(s) vers la corbeille`);
        setSelected(new Set());
        fetchOrders(true);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const reclassify = async () => {
    setReclassifying(true);
    const res = await fetch('/api/orders/reclassify', { method: 'POST' });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else {
      toast.success(json.message);
      fetchOrders(true);
    }
    setReclassifying(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = orders.length > 0 && selected.size === orders.length;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const tabCount = (key: string) => {
    if (!counts) return null;
    if (key === 'all') return Object.values(counts).reduce((a, b) => a + b, 0);
    if (key === 'en_cours')
      return (counts.en_preparation ?? 0) + (counts.en_transit ?? 0) + (counts.en_livraison ?? 0);
    return counts[key] ?? 0;
  };

  const menuItem =
    'w-full flex items-center gap-2.5 px-3 py-2 text-left text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50';
  const pagerButton =
    'h-8 px-3 rounded-md border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 disabled:text-stone-300 dark:disabled:text-stone-600 hover:bg-stone-50 dark:hover:bg-stone-800 disabled:hover:bg-transparent';

  return (
    <>
      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onDeleted={() => fetchOrders(true)}
      />

      {/* Onglets par statut */}
      <div className="flex items-center gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-stone-200 dark:border-stone-800 text-[14px]">
        {TABS.map((t) => {
          const active = statusFilter === t.key;
          const n = tabCount(t.key);
          return (
            <button
              key={t.key}
              onClick={() => {
                setStatusFilter(t.key);
                setPage(1);
              }}
              className={`pb-3 -mb-px border-b-2 whitespace-nowrap transition-colors ${
                active
                  ? 'border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-50 font-medium'
                  : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              {t.label}
              {n !== null && (
                <span
                  className={`ml-1.5 tabular-nums ${active ? 'text-stone-400' : 'text-stone-300 dark:text-stone-600'}`}
                >
                  {n.toLocaleString('fr-FR')}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Recherche + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-[380px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Rechercher un client, un numéro, un tracking…"
            className="w-full h-9 pl-9 pr-3 text-[13.5px] rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 dark:focus:ring-white/10"
          />
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-stone-500">{selected.size} sélectionnée(s)</span>
            <button
              onClick={handleBulkDelete}
              disabled={deleting}
              className="h-9 px-3 rounded-md border border-red-200 dark:border-red-500/30 text-[13px] text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {deleting ? 'Déplacement…' : 'Corbeille'}
            </button>
          </div>
        )}

        <div className="flex-1" />
        {lastRefresh && (
          <span className="hidden md:inline text-[12.5px] text-stone-400">
            Mis à jour à {lastRefresh.slice(0, 5)}
          </span>
        )}

        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Plus d'options"
            className="h-9 w-9 grid place-items-center rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-500 hover:text-stone-800 dark:hover:text-stone-100"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-2 w-64 z-40 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-lg py-1 text-[13.5px]">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    fetchOrders();
                    fetchCounts();
                  }}
                  className={menuItem}
                >
                  <RefreshCw size={15} /> Actualiser
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    reclassify();
                  }}
                  disabled={reclassifying}
                  className={menuItem}
                >
                  <Wand2 size={15} /> Corriger les statuts
                </button>
                <div className="my-1 border-t border-stone-100 dark:border-stone-800" />
                <div className="px-3 py-1.5 text-[12px] text-stone-400">Commandes par page</div>
                <div className="flex gap-1 px-3 pb-2">
                  {[10, 25, 50, 100].map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        setPageSize(n);
                        setPage(1);
                        setMenuOpen(false);
                      }}
                      className={`flex-1 h-7 rounded text-[12.5px] tabular-nums ${
                        pageSize === n
                          ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900'
                          : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tableau */}
      <div className="rounded-xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12.5px] text-stone-400 border-b border-stone-100 dark:border-stone-800">
                <th className="w-12 pl-6 pr-3 py-3 font-normal">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Tout sélectionner"
                    className="rounded border-stone-300 dark:border-stone-600 cursor-pointer"
                  />
                </th>
                <th className="py-3 pr-4 font-normal">Client</th>
                <th className="py-3 pr-4 font-normal">Produit</th>
                <th className="py-3 pr-4 font-normal">Wilaya</th>
                <th className="py-3 pr-4 font-normal">Statut</th>
                <th className="py-3 pr-6 font-normal text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-t border-stone-100 dark:border-stone-800">
                    <td colSpan={6} className="px-6 py-4">
                      <div className="h-8 rounded bg-stone-100 dark:bg-stone-800 animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <p className="text-[14px] font-medium text-stone-700 dark:text-stone-200">
                      Aucune commande trouvée
                    </p>
                    <p className="text-[13px] text-stone-400 mt-1">
                      Changez d’onglet ou de recherche, ou lancez une synchronisation.
                    </p>
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const p = prettyProduct(order.product_name);
                  const b = statusBadge(order.delivery_status);
                  const situation = order.situation?.trim();
                  return (
                    <tr
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      className={`border-t border-stone-100 dark:border-stone-800 cursor-pointer transition-colors hover:bg-stone-50/70 dark:hover:bg-white/[0.03] ${
                        selected.has(order.id) ? 'bg-stone-50 dark:bg-white/[0.04]' : ''
                      }`}
                    >
                      <td
                        className="w-12 pl-6 pr-3 py-3.5"
                        onClick={(e) => toggleSelect(order.id, e)}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(order.id)}
                          onChange={() => {}}
                          aria-label="Sélectionner"
                          className="rounded border-stone-300 dark:border-stone-600 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 pr-4 max-w-[220px]">
                        <div className="font-medium text-stone-900 dark:text-stone-100 truncate">
                          <bdi>{order.customer_name || '—'}</bdi>
                        </div>
                        <div className="text-[12.5px] text-stone-400 tabular-nums">
                          {order.customer_whatsapp || '—'}
                        </div>
                      </td>
                      <td className="py-3.5 pr-4 max-w-[260px]">
                        <div className="text-stone-800 dark:text-stone-200 truncate">{p.name}</div>
                        <div className="text-[12.5px] text-stone-400 truncate">
                          {p.variant && <>{p.variant} · </>}
                          <span
                            className="font-mono text-[11.5px] hover:text-stone-700 dark:hover:text-stone-200"
                            title="Copier le tracking"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyTracking(order.tracking_number);
                            }}
                          >
                            {order.tracking_number}
                            {copiedId === order.tracking_number && (
                              <CheckCheck size={11} className="inline ml-1 text-emerald-500" />
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 pr-4 text-stone-600 dark:text-stone-300 whitespace-nowrap">
                        {order.wilaya || '—'}
                      </td>
                      <td className="py-3.5 pr-4">
                        <span
                          className={`text-[12px] font-medium px-2 py-0.5 rounded whitespace-nowrap ${b.className}`}
                        >
                          {b.label}
                        </span>
                        {situation && situation.toLowerCase() !== b.label.toLowerCase() && (
                          <div className="text-[12px] text-stone-400 mt-1 truncate max-w-[180px]">
                            {situation}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 pr-6 text-right tabular-nums text-stone-900 dark:text-stone-100 whitespace-nowrap">
                        {order.cod ? formatDA(order.cod) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-stone-100 dark:border-stone-800 text-[13px] text-stone-500">
          <span className="tabular-nums">
            {total > 0 ? `Affichage de ${from} à ${to} sur ${total.toLocaleString('fr-FR')}` : '—'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className={pagerButton}
            >
              Précédent
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className={pagerButton}
            >
              Suivant
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
