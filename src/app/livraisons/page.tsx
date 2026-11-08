'use client';

import AppLayout from '@/components/ui/AppLayout';
import { StatCard, type Tone } from '@/components/ui/primitives';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Truck, CheckCircle2, XCircle, Clock } from 'lucide-react';

export default function LivraisonsPage() {
  const [stats, setStats] = useState({ en_livraison: 0, livre: 0, echec: 0, retourne: 0 });
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      // Via l'API (service_role + scoping session) : la lecture directe de
      // `orders` depuis le navigateur échoue (RLS 42P17).
      const res = await fetch('/api/orders/view?view=livraisons');
      const { data } = (res.ok ? await res.json() : { data: null }) as { data: any[] | null };

      if (data) {
        setOrders(data);
        setStats({
          en_livraison: data.filter((o) => o.delivery_status === 'en_livraison').length,
          livre: data.filter((o) => o.delivery_status === 'livre').length,
          echec: data.filter((o) => o.delivery_status === 'echec').length,
          retourne: data.filter((o) => o.delivery_status === 'retourne').length,
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
    retourne: 'bg-stone-100 text-stone-600 dark:text-stone-300',
  };

  const statusLabel: Record<string, string> = {
    en_livraison: 'En livraison',
    livre: 'Livré',
    echec: 'Échec',
    retourne: 'Retourné',
  };

  return (
    <AppLayout>
      <div className="max-w-[1120px] mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10 space-y-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-indigo-950 dark:text-stone-50">
              Livraisons
            </h1>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Suivi des livraisons en cours
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'En livraison', value: stats.en_livraison, icon: Truck, color: 'amber' },
            { label: 'Livrées', value: stats.livre, icon: CheckCircle2, color: 'green' },
            { label: 'Échecs', value: stats.echec, icon: XCircle, color: 'red' },
            { label: 'Retournées', value: stats.retourne, icon: Clock, color: 'stone' },
          ].map((s) => (
            <StatCard
              key={s.label}
              icon={s.icon}
              label={s.label}
              value={s.value}
              tone={s.color as Tone}
              loading={loading}
            />
          ))}
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-stone-900 card-soft overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800">
            <h2 className="font-bold text-indigo-950 dark:text-stone-100">Détail des livraisons</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[12px] font-bold uppercase tracking-wide text-violet-500/80 dark:text-violet-300/70 bg-violet-50/60 dark:bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-3 text-left">Tracking</th>
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-left">Wilaya</th>
                  <th className="px-4 py-3 text-left">Statut</th>
                  <th className="px-4 py-3 text-left">Tentatives</th>
                  <th className="px-4 py-3 text-left">Mise à jour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                {loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-stone-400 dark:text-stone-500"
                    >
                      Chargement...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-stone-400 dark:text-stone-500"
                    >
                      Aucune livraison trouvée
                    </td>
                  </tr>
                ) : (
                  // 200 plus récentes : au-delà, le tableau gelait la page (≈7 000 lignes).
                  orders.slice(0, 200).map((o) => (
                    <tr key={o.id} className="hover:bg-violet-50/50 dark:hover:bg-white/[0.04]">
                      <td className="px-4 py-3 font-mono text-xs font-medium">
                        {o.tracking_number}
                      </td>
                      <td className="px-4 py-3 font-medium">{o.customer_name}</td>
                      <td className="px-4 py-3 text-stone-500 dark:text-stone-400">
                        {o.wilaya || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusBadge[o.delivery_status] || ''}`}
                        >
                          {statusLabel[o.delivery_status] || o.delivery_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">{o.attempts ?? 0}</td>
                      <td className="px-4 py-3 text-stone-400 dark:text-stone-500 text-xs">
                        {o.last_update ? new Date(o.last_update).toLocaleDateString('fr-FR') : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {orders.length > 200 && (
            <div className="px-6 py-4 border-t border-stone-100 dark:border-stone-800 text-[13px] text-stone-500 flex items-center justify-between">
              <span>200 plus récentes sur {orders.length.toLocaleString('fr-FR')}</span>
              <Link
                href="/commandes"
                className="text-violet-700 dark:text-violet-300 font-semibold hover:underline"
              >
                Voir toutes les commandes
              </Link>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
