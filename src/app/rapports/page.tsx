'use client';

import AppLayout from '@/components/ui/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, Package, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';

export default function RapportsPage() {
  const [stats, setStats] = useState<any>({});
  const [byWilaya, setByWilaya] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase.from('orders').select('status, wilaya, cod');
      if (data) {
        const total = data.length;
        const livre = data.filter(o => o.status === 'livre').length;
        const echec = data.filter(o => o.status === 'echec').length;
        const retourne = data.filter(o => o.status === 'retourne').length;
        const en_cours = data.filter(o => ['en_preparation','en_transit','en_livraison'].includes(o.status)).length;
        setStats({ total, livre, echec, retourne, en_cours, rate: total > 0 ? Math.round((livre / total) * 100) : 0 });

        // By wilaya
        const map = new Map<string, number>();
        data.forEach(o => { if (o.wilaya) map.set(o.wilaya, (map.get(o.wilaya) || 0) + 1); });
        setByWilaya(Array.from(map.entries()).map(([w, n]) => ({ wilaya: w, count: n })).sort((a, b) => b.count - a.count).slice(0, 10));
      }
      setLoading(false);
    };
    fetch();
  }, []);

  return (
    <AppLayout>
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <BarChart3 size={20} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Rapports</h1>
            <p className="text-sm text-gray-500">Statistiques et analyses de vos commandes</p>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {[
            { label: 'Total', value: stats.total, icon: Package, color: 'blue' },
            { label: 'Livrées', value: stats.livre, icon: CheckCircle2, color: 'green' },
            { label: 'En cours', value: stats.en_cours, icon: TrendingUp, color: 'amber' },
            { label: 'Échecs', value: stats.echec, icon: XCircle, color: 'red' },
            { label: 'Retours', value: stats.retourne, icon: RotateCcw, color: 'gray' },
            { label: 'Taux livraison', value: `${stats.rate || 0}%`, icon: TrendingUp, color: 'indigo' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <p className="text-2xl font-bold text-gray-900">{loading ? '—' : s.value ?? 0}</p>
              <p className="text-sm text-gray-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Top wilayas */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Top Wilayas</h2>
          {loading ? <p className="text-gray-400">Chargement...</p> : byWilaya.length === 0 ? (
            <p className="text-gray-400">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-3">
              {byWilaya.map((w, i) => (
                <div key={w.wilaya} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700">{w.wilaya}</span>
                      <span className="text-sm font-bold text-gray-900">{w.count}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${Math.round((w.count / (byWilaya[0]?.count || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
