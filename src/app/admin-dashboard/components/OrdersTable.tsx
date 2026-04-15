'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Eye,
  MessageSquare,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CheckCheck,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import ManualMessageModal from './ManualMessageModal';

type Status = 'en_preparation' | 'en_transit' | 'en_livraison' | 'livre' | 'echec' | 'retourne';

interface Order {
  id: string;
  tracking: string;
  client: string;
  whatsapp: string;
  product: string;
  wilaya: string;
  wilayaCode: string;
  status: Status;
  lastUpdate: string;
  attempts: number;
  weight: string;
  cod: string;
}

const orders: Order[] = [
  { id: 'order-001', tracking: 'ZRX-204817', client: 'Nassim Boukhalfa', whatsapp: '+213 555 123 456', product: 'Robe soirée × 2', wilaya: 'Annaba', wilayaCode: '23', status: 'en_transit', lastUpdate: '28/03 09:14', attempts: 1, weight: '1.2 kg', cod: '4 500 DZD' },
  { id: 'order-002', tracking: 'ZRX-198342', client: 'Fatima Zerrouki', whatsapp: '+213 661 987 654', product: 'Sneakers Nike T42', wilaya: 'Constantine', wilayaCode: '25', status: 'echec', lastUpdate: '27/03 16:42', attempts: 3, weight: '0.8 kg', cod: '6 200 DZD' },
  { id: 'order-003', tracking: 'ZRX-211093', client: 'Yacine Hadj Amar', whatsapp: '+213 770 345 678', product: 'Montre Casio G-Shock', wilaya: 'Tizi Ouzou', wilayaCode: '15', status: 'en_livraison', lastUpdate: '28/03 11:30', attempts: 1, weight: '0.4 kg', cod: '8 900 DZD' },
  { id: 'order-004', tracking: 'ZRX-207561', client: 'Amina Bensalem', whatsapp: '+213 550 678 901', product: 'Caftan mariage × 1', wilaya: 'Alger', wilayaCode: '16', status: 'livre', lastUpdate: '28/03 13:55', attempts: 1, weight: '2.1 kg', cod: '12 000 DZD' },
  { id: 'order-005', tracking: 'ZRX-203498', client: 'Rachid Bouchenak', whatsapp: '+213 699 234 567', product: 'Parfum Lattafa 100ml', wilaya: 'Oran', wilayaCode: '31', status: 'livre', lastUpdate: '28/03 10:20', attempts: 1, weight: '0.3 kg', cod: '3 200 DZD' },
  { id: 'order-006', tracking: 'ZRX-215782', client: 'Souad Khelifi', whatsapp: '+213 771 456 789', product: 'Tapis berbère 2×3m', wilaya: 'Béjaïa', wilayaCode: '06', status: 'en_preparation', lastUpdate: '28/03 08:00', attempts: 0, weight: '4.5 kg', cod: '18 500 DZD' },
  { id: 'order-007', tracking: 'ZRX-199001', client: 'Karim Touati', whatsapp: '+213 560 890 123', product: 'Écouteurs JBL × 1', wilaya: 'Sétif', wilayaCode: '19', status: 'retourne', lastUpdate: '26/03 14:10', attempts: 2, weight: '0.5 kg', cod: '5 400 DZD' },
  { id: 'order-008', tracking: 'ZRX-218345', client: 'Lynda Meddour', whatsapp: '+213 662 345 012', product: 'Sac à main cuir', wilaya: 'Blida', wilayaCode: '09', status: 'en_transit', lastUpdate: '28/03 07:45', attempts: 1, weight: '0.9 kg', cod: '7 800 DZD' },
  { id: 'order-009', tracking: 'ZRX-221067', client: 'Hocine Aissaoui', whatsapp: '+213 553 567 234', product: 'Veste cuir homme', wilaya: 'Batna', wilayaCode: '05', status: 'en_livraison', lastUpdate: '28/03 12:15', attempts: 1, weight: '1.8 kg', cod: '9 600 DZD' },
  { id: 'order-010', tracking: 'ZRX-195678', client: 'Meriem Chentouf', whatsapp: '+213 770 123 890', product: 'Ensemble bébé × 3', wilaya: 'Tlemcen', wilayaCode: '13', status: 'livre', lastUpdate: '27/03 17:30', attempts: 1, weight: '0.7 kg', cod: '2 800 DZD' },
  { id: 'order-011', tracking: 'ZRX-209834', client: 'Sofiane Belhadj', whatsapp: '+213 699 789 345', product: 'Casque gaming RGB', wilaya: 'Médéa', wilayaCode: '26', status: 'en_transit', lastUpdate: '28/03 06:30', attempts: 1, weight: '1.1 kg', cod: '11 200 DZD' },
  { id: 'order-012', tracking: 'ZRX-223456', client: 'Nadia Hamidouche', whatsapp: '+213 561 234 678', product: 'Huile argan bio 250ml', wilaya: 'Djelfa', wilayaCode: '17', status: 'en_preparation', lastUpdate: '28/03 08:45', attempts: 0, weight: '0.6 kg', cod: '1 900 DZD' },
];

const statusConfig: Record<Status, { label: string; badge: string; dot: string }> = {
  en_preparation: { label: 'En préparation', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  en_transit: { label: 'En transit', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  en_livraison: { label: 'En livraison', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  livre: { label: 'Livré', badge: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  echec: { label: 'Échec', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  retourne: { label: 'Retourné', badge: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
};

const statusFilters: { key: string; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'en_preparation', label: 'En préparation' },
  { key: 'en_transit', label: 'En transit' },
  { key: 'en_livraison', label: 'En livraison' },
  { key: 'livre', label: 'Livrés' },
  { key: 'echec', label: 'Échecs' },
  { key: 'retourne', label: 'Retournés' },
];

type SortKey = 'tracking' | 'client' | 'wilaya' | 'status' | 'lastUpdate' | 'cod';

export default function OrdersTable() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('lastUpdate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [perPage] = useState(8);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [messageModal, setMessageModal] = useState<Order | null>(null);
  const [statusDropdown, setStatusDropdown] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = [...orders];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          o.tracking.toLowerCase().includes(q) ||
          o.client.toLowerCase().includes(q) ||
          o.product.toLowerCase().includes(q) ||
          o.wilaya.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter);
    }
    result.sort((a, b) => {
      const av = a[sortKey as keyof Order] ?? '';
      const bv = b[sortKey as keyof Order] ?? '';
      const cmp = String(av).localeCompare(String(bv), 'fr');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [search, statusFilter, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const toggleSelect = (id: string) => {
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  };

  const toggleAll = () => {
    if (selected.length === paginated.length) setSelected([]);
    else setSelected(paginated.map((o) => o.id));
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleStatusChange = (orderId: string, newStatus: Status) => {
    setUpdatingStatus(orderId);
    setStatusDropdown(null);
    // TODO: Connect to ZREXpress API PATCH /api/orders/{orderId}/status
    setTimeout(() => {
      setUpdatingStatus(null);
      toast.success('Statut mis à jour', {
        description: `Commande ${orderId} → ${statusConfig[newStatus].label}`,
      });
    }, 900);
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronUp size={12} className="text-[hsl(var(--border))]" />;
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="text-[hsl(var(--primary))]" />
      : <ChevronDown size={12} className="text-[hsl(var(--primary))]" />;
  };

  return (
    <>
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-[15px] font-600 text-[hsl(var(--foreground))]">Commandes</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                {filtered.length} résultat{filtered.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <input
                  type="text"
                  placeholder="Chercher commande, client..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8 pr-3 py-2 text-sm bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:border-transparent transition-all"
                />
              </div>
              <button className="flex items-center gap-1.5 px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] transition-all duration-150">
                <Filter size={14} />
                Filtres
              </button>
            </div>
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-1.5">
            {statusFilters.map((f) => (
              <button
                key={`chip-${f.key}`}
                onClick={() => { setStatusFilter(f.key); setPage(1); }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 ${
                  statusFilter === f.key
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--border))]'
                }`}
              >
                {f.label}
                {f.key !== 'all' && (
                  <span className="ml-1 opacity-70">
                    ({orders.filter((o) => o.status === f.key).length})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Bulk action bar */}
        {selected.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2.5 bg-[hsl(var(--accent))] border-b border-[hsl(var(--border))] animate-slide-up">
            <span className="text-sm font-medium text-[hsl(var(--primary))]">
              {selected.length} sélectionné{selected.length > 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2 ml-2">
              <button
                onClick={() => {
                  // TODO: Bulk WhatsApp send POST /api/whatsapp/bulk
                  toast.success(`Messages envoyés à ${selected.length} clients`);
                  setSelected([]);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--primary))] text-white text-xs font-medium hover:bg-green-700 transition-all active:scale-95"
              >
                <MessageSquare size={12} />
                Envoyer WhatsApp
              </button>
              <button
                onClick={() => setSelected([])}
                className="px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-white transition-all"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-[hsl(var(--secondary))] border-b border-[hsl(var(--border))]">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.length === paginated.length && paginated.length > 0}
                    onChange={toggleAll}
                    className="w-3.5 h-3.5 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                  />
                </th>
                {[
                  { key: 'tracking', label: 'N° Tracking' },
                  { key: 'client', label: 'Client' },
                  { key: null, label: 'WhatsApp' },
                  { key: null, label: 'Produit' },
                  { key: 'wilaya', label: 'Wilaya' },
                  { key: 'status', label: 'Statut' },
                  { key: null, label: 'Tentatives' },
                  { key: 'cod', label: 'COD' },
                  { key: 'lastUpdate', label: 'Mise à jour' },
                  { key: null, label: 'Actions' },
                ].map((col, i) => (
                  <th
                    key={`th-${i}`}
                    className={`px-3 py-3 text-left text-[11px] font-600 uppercase tracking-wide text-[hsl(var(--muted-foreground))] whitespace-nowrap ${
                      col.key ? 'cursor-pointer select-none hover:text-[hsl(var(--foreground))]' : ''
                    }`}
                    onClick={() => col.key && toggleSort(col.key as SortKey)}
                  >
                    <span className="flex items-center gap-1">
                      {col.label}
                      {col.key && <SortIcon col={col.key as SortKey} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 bg-[hsl(var(--secondary))] rounded-xl flex items-center justify-center">
                        <Search size={20} className="text-[hsl(var(--muted-foreground))]" />
                      </div>
                      <p className="text-sm font-medium text-[hsl(var(--foreground))]">Aucune commande trouvée</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        Modifiez votre recherche ou les filtres de statut
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((order) => {
                  const s = statusConfig[order.status];
                  const isSelected = selected.includes(order.id);
                  const isUpdating = updatingStatus === order.id;
                  return (
                    <tr
                      key={order.id}
                      className={`group transition-colors duration-100 ${
                        isSelected ? 'bg-[hsl(var(--accent))]' : 'hover:bg-[hsl(var(--secondary))]/50'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(order.id)}
                          className="w-3.5 h-3.5 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">
                            {order.tracking}
                          </span>
                          <button
                            onClick={() => handleCopy(order.id, order.tracking)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                          >
                            {copiedId === order.id ? (
                              <CheckCheck size={12} className="text-green-600" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-sm font-medium text-[hsl(var(--foreground))] whitespace-nowrap">
                          {order.client}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums font-medium">
                          {order.whatsapp}
                        </span>
                      </td>
                      <td className="px-3 py-3 max-w-[160px]">
                        <span className="text-sm text-[hsl(var(--foreground))] truncate block" title={order.product}>
                          {order.product}
                        </span>
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{order.weight}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-sm text-[hsl(var(--foreground))] whitespace-nowrap">
                          {order.wilaya}
                          <span className="text-[11px] text-[hsl(var(--muted-foreground))] ml-1">({order.wilayaCode})</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 relative">
                        {isUpdating ? (
                          <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                            <Loader2 size={12} className="animate-spin" />
                            Mise à jour...
                          </span>
                        ) : (
                          <button
                            onClick={() => setStatusDropdown(statusDropdown === order.id ? null : order.id)}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${s.badge} hover:opacity-80 transition-opacity cursor-pointer`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                            {s.label}
                          </button>
                        )}
                        {statusDropdown === order.id && (
                          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-[hsl(var(--border))] rounded-xl shadow-lg py-1 min-w-[180px] animate-fade-in">
                            {(Object.entries(statusConfig) as [Status, typeof statusConfig[Status]][]).map(([key, cfg]) => (
                              <button
                                key={`status-opt-${key}`}
                                onClick={() => handleStatusChange(order.id, key)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[hsl(var(--secondary))] transition-colors ${
                                  order.status === key ? 'opacity-50 cursor-default' : ''
                                }`}
                              >
                                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                                {cfg.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-xs font-semibold tabular-nums ${order.attempts >= 3 ? 'text-red-600' : order.attempts === 2 ? 'text-amber-600' : 'text-[hsl(var(--muted-foreground))]'}`}>
                          {order.attempts}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-sm font-semibold tabular-nums text-[hsl(var(--foreground))] whitespace-nowrap">
                          {order.cod}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums whitespace-nowrap">
                          {order.lastUpdate}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            title="Voir le détail"
                            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--border))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            title="Envoyer un message WhatsApp"
                            onClick={() => setMessageModal(order)}
                            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-green-100 hover:text-green-700 transition-all duration-150"
                          >
                            <MessageSquare size={14} />
                          </button>
                          <button
                            title="Plus d'options"
                            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--border))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/30">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Affichage de{' '}
              <span className="font-medium text-[hsl(var(--foreground))]">
                {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)}
              </span>{' '}
              sur{' '}
              <span className="font-medium text-[hsl(var(--foreground))]">{filtered.length}</span>{' '}
              commandes
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={`page-${p}`}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded-lg text-xs font-medium transition-all ${
                    page === p
                      ? 'bg-[hsl(var(--primary))] text-white'
                      : 'border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-white'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {messageModal && (
        <ManualMessageModal
          order={messageModal}
          onClose={() => setMessageModal(null)}
        />
      )}
    </>
  );
}