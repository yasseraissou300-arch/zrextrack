'use client';

import AppLayout from '@/components/ui/AppLayout';
import { useEffect, useState } from 'react';
import { Bell, AlertTriangle, XCircle } from 'lucide-react';

export default function AlertesPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      setLoading(true);
      // Via l'API (service_role + scoping session) : la lecture directe de
      // `orders` depuis le navigateur échoue (RLS 42P17).
      const res = await fetch('/api/orders/view?view=alertes');
      const { data } = (res.ok ? await res.json() : { data: null }) as { data: any[] | null };
      setAlerts(data || []);
      setLoading(false);
    };
    fetchAlerts();
  }, []);

  return (
    <AppLayout>
      <div className="max-w-[1120px] mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10 space-y-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
              Alertes
            </h1>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Commandes en échec ou retournées nécessitant attention
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200/80 dark:border-stone-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="font-semibold text-stone-900 dark:text-stone-100">
              Commandes problématiques ({alerts.length})
            </h2>
          </div>
          <div className="divide-y divide-stone-50 dark:divide-stone-800">
            {loading ? (
              <div className="px-6 py-8 text-center text-stone-400 dark:text-stone-500">
                Chargement...
              </div>
            ) : alerts.length === 0 ? (
              <div className="px-6 py-8 text-center text-stone-400 dark:text-stone-500">
                <Bell size={32} className="mx-auto mb-2 opacity-30" />
                <p>Aucune alerte — tout va bien ! 🎉</p>
              </div>
            ) : (
              alerts.map((o) => (
                <div
                  key={o.id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-800"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <XCircle
                        size={14}
                        className={
                          o.delivery_status === 'echec'
                            ? 'text-red-500'
                            : 'text-stone-400 dark:text-stone-500'
                        }
                      />
                      <span className="font-mono text-xs font-medium text-stone-700 dark:text-stone-200">
                        {o.tracking_number}
                      </span>
                      <span className="font-medium text-stone-900 dark:text-stone-100">
                        {o.customer_name}
                      </span>
                    </div>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 ml-5">
                      {o.wilaya} — {o.product_name || 'Produit non précisé'}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${o.delivery_status === 'echec' ? 'bg-red-100 text-red-700' : 'bg-stone-100 text-stone-600 dark:text-stone-300'}`}
                    >
                      {o.delivery_status === 'echec' ? 'Échec' : 'Retourné'}
                    </span>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                      {o.attempts ?? 0} tentative(s)
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
