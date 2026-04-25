'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, RefreshCw, Copy, CheckCheck, ChevronRight as Arrow, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { SYNC_DONE_EVENT } from './DashboardHeader';
import OrderDetailModal from './OrderDetailModal';

type Status = 'en_preparation' | 'en_transit' | 'en_livraison' | 'livre' | 'echec' | 'retourne';

interface Order {
  id: string;
  tracking: string;
  client: string;
  whatsapp: string;
  product: string;
  wilaya: string;
  district: string;
  status: Status;
  situation: string;
  delivery_type: string;
  delivery_fees: number;
  last_update: string;
  attempts: number;
  cod: number;
}

const statusConfig: Record<Status, { label: string; badge: string }> = {
  en_preparation: { label: 'En préparation', badge: 'bg-purple-100 text-purple-700' },
  en_transit: { label: 'En transit', badge: 'bg-blue-100 text-blue-700' },
  en_livraison: { label: 'En livraison', badge: 'bg-amber-100 text-amber-700' },
  livre: { label: 'Livré', badge: 'bg-green-100 text-green-700' },
  echec: { label: 'Échec', badge: 'bg-red-100 text-red-700' },
  retourne: { label: 'Retourné', badge: 'bg-gray-100 text-gray-600' },
};

function formatDeliveryType(type: string): string {
  if (!type) return '—';
  const t = type.toLowerCase();
  if (t.includes('pickup') || t.includes('point')) return 'Point relais';
  if (t.includes('home') || t.includes('domicile')) return 'Domicile';
  if (t.includes('bureau') || t.includes('desk')) return 'Bureau';
  return type;
}

const POLL_INTERVAL = 5_000;

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

  const fetchOrders = useCallback(async (silent = false) => {
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
  }, [page, statusFilter, search, pageSize]);

  // Polling toutes les 5 secondes (silencieux)
  useEffect(() => {
    fetchOrders();
    const interval = setInterval(() => fetchOrders(true), POLL_INTERVAL);
    return () => clearInterval(interval);
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
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === orders.length && orders.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map(o => o.id)));
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
    else { toast.success(json.message); fetchOrders(true); }
    setReclassifying(false);
  };

  const totalPages = Math.ceil(total / pageSize);
  const allSelected = orders.length > 0 && selected.size === orders.length;

  return (
    <>
    <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} onDeleted={() => fetchOrders(true)} />
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-800 text-sm">Commandes récentes <span className="text-gray-400 font-normal">({total})</span></h2>
          {lastRefresh && <span className="text-[10px] text-gray-300 font-mono">{lastRefresh}</span>}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {selected.size > 0 && (
            <div className="flex items-center gap-2 mr-1">
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">{selected.size} sélectionnée(s)</span>
              <button
                onClick={handleBulkDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                <Trash2 size={12} />
                {deleting ? 'Suppression...' : 'Mettre à la corbeille'}
              </button>
            </div>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Rechercher..."
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none"
          >
            <option value="all">Tous les statuts</option>
            <option value="en_preparation">En préparation</option>
            <option value="en_transit">En transit</option>
            <option value="en_livraison">En livraison</option>
            <option value="livre">Livrés</option>
            <option value="echec">Échecs</option>
            <option value="retourne">Retournés</option>
          </select>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none text-gray-600"
            title="Commandes par page"
          >
            <option value={10}>10 / page</option>
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
          <button
            onClick={reclassify}
            disabled={reclassifying}
            title="Recorrige les statuts mal classifiés (Appelé sans réponse, Annulé, Erroné…)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-amber-200 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors"
          >
            <Wand2 size={12} className={reclassifying ? 'animate-spin' : ''} />
            {reclassifying ? 'Correction...' : 'Corriger statuts'}
          </button>
          <button onClick={() => fetchOrders()} className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">
            <RefreshCw size={14} className="text-gray-500" />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="px-4 py-2.5 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-gray-300 cursor-pointer"
                />
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Tracking</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Client</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Produit</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Wilaya</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Statut</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Livraison</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider">COD</th>
              <th className="px-4 py-2.5 text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Tentatives</th>
              <th className="px-2 py-2.5 w-6"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Aucune commande trouvée</td></tr>
            ) : orders.map(order => (
              <tr
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                className={`border-b border-gray-50 hover:bg-slate-50 transition-colors cursor-pointer group ${selected.has(order.id) ? 'bg-red-50/40' : ''}`}
              >
                <td className="px-4 py-3" onClick={e => toggleSelect(order.id, e)}>
                  <input
                    type="checkbox"
                    checked={selected.has(order.id)}
                    onChange={() => {}}
                    className="rounded border-gray-300 cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold text-blue-600">{order.tracking}</span>
                    <button
                      onClick={e => { e.stopPropagation(); copyTracking(order.tracking); }}
                      className="text-gray-300 hover:text-gray-500 transition-colors"
                    >
                      {copiedId === order.tracking ? <CheckCheck size={11} className="text-green-500" /> : <Copy size={11} />}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-gray-800">{order.client}</p>
                  <p className="text-xs text-gray-400">{order.whatsapp}</p>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 max-w-[140px] truncate">{order.product || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600 font-medium">{order.wilaya || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${statusConfig[order.status]?.badge || 'bg-gray-100 text-gray-600'}`}>
                    {order.situation?.trim() || statusConfig[order.status]?.label || order.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{formatDeliveryType(order.delivery_type)}</td>
                <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                  {order.cod ? `${Number(order.cod).toLocaleString('fr-DZ')} DA` : '—'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-md px-2 py-0.5">{order.attempts ?? 0}</span>
                </td>
                <td className="px-2 py-3">
                  <Arrow size={13} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
