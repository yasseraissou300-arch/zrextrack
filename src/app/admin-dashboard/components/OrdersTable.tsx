'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, RefreshCw, Copy, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

type Status = 'en_preparation' | 'en_transit' | 'en_livraison' | 'livre' | 'echec' | 'retourne';

interface Order {
  id: string;
  tracking: string;
  client: string;
  whatsapp: string;
  product: string;
  wilaya: string;
  wilaya_code: string;
  status: Status;
  last_update: string;
  attempts: number;
  weight: string;
  cod: string;
}

const statusConfig: Record<Status, { label: string; badge: string }> = {
  en_preparation: { label: 'En preparation', badge: 'bg-purple-100 text-purple-700' },
  en_transit: { label: 'En transit', badge: 'bg-blue-100 text-blue-700' },
  en_livraison: { label: 'En livraison', badge: 'bg-amber-100 text-amber-700' },
  livre: { label: 'Livre', badge: 'bg-green-100 text-green-700' },
  echec: { label: 'Echec', badge: 'bg-red-100 text-red-700' },
  retourne: { label: 'Retourne', badge: 'bg-gray-100 text-gray-600' },
};

const PAGE_SIZE = 10;

export default function OrdersTable() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        status: statusFilter,
        search,
      });
      const res = await fetch('/api/orders?' + params);
      const json = await res.json();
      if (json.error) {
        toast.error(json.error);
      } else {
        setOrders(json.data || []);
        setTotal(json.count || 0);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const copyTracking = (tracking: string) => {
    navigator.clipboard.writeText(tracking);
    setCopiedId(tracking);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Tracking copie !');
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <h2 className="font-semibold text-gray-900">Commandes ({total})</h2>
        <div className="flex gap-2 flex-wrap">
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
            <option value="en_preparation">En preparation</option>
            <option value="en_transit">En transit</option>
            <option value="en_livraison">En livraison</option>
            <option value="livre">Livres</option>
            <option value="echec">Echecs</option>
            <option value="retourne">Retournes</option>
          </select>
          <button onClick={fetchOrders} className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">
            <RefreshCw size={14} className="text-gray-500" />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Tracking</th>
              <th className="px-4 py-3 text-left">Client</th>
              <th className="px-4 py-3 text-left">Produit</th>
              <th className="px-4 py-3 text-left">Wilaya</th>
              <th className="px-4 py-3 text-left">Statut</th>
              <th className="px-4 py-3 text-left">COD</th>
              <th className="px-4 py-3 text-left">Tentatives</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucune commande trouvee</td></tr>
            ) : orders.map(order => (
              <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium text-gray-900">{order.tracking}</span>
                    <button onClick={() => copyTracking(order.tracking)} className="text-gray-400 hover:text-gray-600">
                      {copiedId === order.tracking ? <CheckCheck size={12} className="text-green-500" /> : <Copy size={12} />}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-900">{order.client}</p>
                    <p className="text-xs text-gray-400">{order.whatsapp}</p>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{order.product || '-'}</td>
                <td className="px-4 py-3 text-gray-600">{order.wilaya || '-'}</td>
                <td className="px-4 py-3">
                  <span className={'text-xs font-medium px-2.5 py-1 rounded-full ' + (statusConfig[order.status]?.badge || 'bg-gray-100 text-gray-600')}>
                    {statusConfig[order.status]?.label || order.status}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{order.cod || '-'}</td>
                <td className="px-4 py-3 text-center">{order.attempts ?? 0}</td>
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
  );
}
