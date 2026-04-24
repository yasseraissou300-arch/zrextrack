'use client';

import AppLayout from '@/components/ui/AppLayout';
import { useEffect, useState, useCallback } from 'react';
import { Trash2, RotateCcw, RefreshCw, Search, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface DeletedOrder {
  id: string;
  tracking: string;
  client: string;
  wilaya: string;
  status: string;
  product: string;
  cod: number;
  deleted_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  en_preparation: 'bg-purple-100 text-purple-700',
  en_transit:     'bg-blue-100 text-blue-700',
  en_livraison:   'bg-amber-100 text-amber-700',
  livre:          'bg-green-100 text-green-700',
  echec:          'bg-red-100 text-red-700',
  retourne:       'bg-gray-100 text-gray-600',
};
const STATUS_LABEL: Record<string, string> = {
  en_preparation: 'En préparation', en_transit: 'En transit', en_livraison: 'En livraison',
  livre: 'Livré', echec: 'Échec', retourne: 'Retourné',
};

export default function CorbeillePage() {
  const [orders, setOrders] = useState<DeletedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  const fetchDeleted = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/orders/deleted');
      const json = await res.json();
      setOrders(json.data || []);
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDeleted(); }, [fetchDeleted]);

  const filtered = orders.filter(o =>
    !search || o.tracking.toLowerCase().includes(search.toLowerCase()) ||
    o.client?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(o => o.id)));
  };

  const handleRestore = async () => {
    if (selected.size === 0) return;
    setWorking(true);
    try {
      const res = await fetch('/api/orders/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const json = await res.json();
      if (json.error) { toast.error(json.error); }
      else {
        toast.success(`${json.restored} commande(s) restaurée(s)`);
        setSelected(new Set());
        fetchDeleted();
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setWorking(false); }
  };

  const handleDeletePermanent = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Supprimer définitivement ${selected.size} commande(s) ? Cette action est irréversible.`)) return;
    setWorking(true);
    try {
      const res = await fetch('/api/orders/delete-permanent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const json = await res.json();
      if (json.error) { toast.error(json.error); }
      else {
        toast.success(`${json.deleted} commande(s) supprimée(s) définitivement`);
        setSelected(new Set());
        fetchDeleted();
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setWorking(false); }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
            <Trash2 size={20} className="text-red-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Corbeille</h1>
            <p className="text-sm text-gray-400">Commandes supprimées — restaurez-les ou supprimez définitivement</p>
          </div>
          <button onClick={fetchDeleted} className="ml-auto p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <RefreshCw size={15} className={`text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
                  className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 w-48" />
              </div>
              <span className="text-xs text-gray-400">{filtered.length} commande(s)</span>
            </div>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">{selected.size} sélectionnée(s)</span>
                <button onClick={handleRestore} disabled={working}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 text-green-700 text-xs font-semibold hover:bg-green-100 transition-colors disabled:opacity-50">
                  <RotateCcw size={12} />Restaurer
                </button>
                <button onClick={handleDeletePermanent} disabled={working}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors disabled:opacity-50">
                  <Trash2 size={12} />Supprimer définitivement
                </button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-2.5 w-10">
                    <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll} className="rounded border-gray-300" />
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Tracking</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Client</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Produit</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Wilaya</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Statut</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider">COD</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Supprimé le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-300">Chargement...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center">
                      <Trash2 size={32} className="mx-auto mb-3 text-gray-200" />
                      <p className="text-gray-400 text-sm">La corbeille est vide</p>
                    </td>
                  </tr>
                ) : filtered.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)} className="rounded border-gray-300" />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-gray-500">{order.tracking}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{order.client || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-[140px] truncate">{order.product || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{order.wilaya || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[order.status] || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_LABEL[order.status] || order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-gray-600">
                      {order.cod ? `${Number(order.cod).toLocaleString('fr-DZ')} DA` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(order.deleted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 text-xs text-amber-600 bg-amber-50">
              <AlertTriangle size={12} />
              La suppression définitive est irréversible. Restaurez d'abord les commandes importantes.
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
