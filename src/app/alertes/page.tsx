'use client';

import AppLayout from '@/components/ui/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { Bell, AlertTriangle, XCircle } from 'lucide-react';

export default function AlertesPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchAlerts = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('orders')
        .select('*')
        .in('delivery_status', ['echec', 'retourne'])
        .order('last_update', { ascending: false })
        .limit(50);
      setAlerts(data || []);
      setLoading(false);
    };
    fetchAlerts();
  }, []);

  return (
    <AppLayout>
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <Bell size={20} className="text-red-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Alertes</h1>
            <p className="text-sm text-gray-500">Commandes en échec ou retournées nécessitant attention</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="font-semibold text-gray-900">Commandes problématiques ({alerts.length})</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="px-6 py-8 text-center text-gray-400">Chargement...</div>
            ) : alerts.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-400">
                <Bell size={32} className="mx-auto mb-2 opacity-30" />
                <p>Aucune alerte — tout va bien ! 🎉</p>
              </div>
            ) : alerts.map(o => (
              <div key={o.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
                <div>
                  <div className="flex items-center gap-2">
                    <XCircle size={14} className={o.delivery_status === 'echec' ? 'text-red-500' : 'text-gray-400'} />
                    <span className="font-mono text-xs font-medium text-gray-700">{o.tracking_number}</span>
                    <span className="font-medium text-gray-900">{o.customer_name}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 ml-5">{o.wilaya} — {o.product_name || 'Produit non précisé'}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${o.delivery_status === 'echec' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                    {o.delivery_status === 'echec' ? 'Échec' : 'Retourné'}
                  </span>
                  <p className="text-xs text-gray-400 mt-1">{o.attempts ?? 0} tentative(s)</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
