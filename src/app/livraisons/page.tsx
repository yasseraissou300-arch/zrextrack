'use client';

import AppLayout from '@/components/ui/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { Truck, CheckCircle2, XCircle, Clock } from 'lucide-react';

export default function LivraisonsPage() {
  const [stats, setStats] = useState({ en_livraison: 0, livre: 0, echec: 0, retourne: 0 });
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('orders')
        .select('*')
        .in('status', ['en_livraison', 'livre', 'echec', 'retourne'])
        .order('last_update', { ascending: false });

      if (data) {
        setOrders(data);
        setStats({
          en_livraison: data.filter(o => o.status === 'en_livraison').length,
          livre: data.filter(o => o.status === 'livre').length,
          echec: data.filter(o => o.status === 'echec').length,
          retourne: data.filter(o => o.status === 'retourne').length,
        });
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  const statusBadge: Record<string, string> = {
    en_livraison: 'bg-amber-100 text-amber-700',
    livre: 'bg-green-100 text-green-700',
    echec: 'bg-red-100 text-red-700',
    retourne: 'bg-gray-100 text-gray-600',
  };

  const statusLabel: Record<string, string> = {
    en_livraison: 'En livraison',
    livre: 'Livré',
    echec: 'Échec',
    retourne: 'Retourné',
  };

  return (
    <AppLayout>
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <Truck size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Livraisons</h1>
            <p className="text-sm text-gray-500">Suivi des livraisons en cours</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'En livraison', value: stats.en_livraison, icon: Truck, color: 'amber' },
            { label: 'Livrées', value: stats.livre, icon: CheckCircle2, color: 'green' },
            { label: 'Échecs', value: stats.echec, icon: XCircle, color: 'red' },
            { label: 'Retournées', value: stats.retourne, icon: Clock, color: 'gray' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <p className="text-2xl font-bold text-gray-900">{loading ? '—' : s.value}</p>
              <p className="text-sm text-gray-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Détail des livraisons</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Tracking</th>
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-left">Wilaya</th>
                  <th className="px-4 py-3 text-left">Statut</th>
                  <th className="px-4 py-3 text-left">Tentatives</th>
                  <th className="px-4 py-3 text-left">Mise à jour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucune livraison trouvée</td></tr>
                ) : orders.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs font-medium">{o.tracking}</td>
                    <td className="px-4 py-3 font-medium">{o.client}</td>
                    <td className="px-4 py-3 text-gray-500">{o.wilaya || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusBadge[o.status] || ''}`}>
                        {statusLabel[o.status] || o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">{o.attempts ?? 0}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {o.last_update ? new Date(o.last_update).toLocaleDateString('fr-FR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
