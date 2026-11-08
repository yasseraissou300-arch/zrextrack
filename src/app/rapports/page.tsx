'use client';

import AppLayout from '@/components/ui/AppLayout';
import { StatCard, type Tone } from '@/components/ui/primitives';
import { useEffect, useState } from 'react';
import { TrendingUp, Package, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';

export default function RapportsPage() {
  const [stats, setStats] = useState<any>({});
  const [byWilaya, setByWilaya] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      // Via l'API (service_role + scoping session) : la lecture directe de
      // `orders` depuis le navigateur échoue (RLS 42P17).
      const res = await fetch('/api/orders/view?view=rapports');
      const { data } = (res.ok ? await res.json() : { data: null }) as { data: any[] | null };
      if (data) {
        const total = data.length;
        const livre = data.filter((o) => o.delivery_status === 'livre').length;
        const echec = data.filter((o) => o.delivery_status === 'echec').length;
        const retourne = data.filter((o) => o.delivery_status === 'retourne').length;
        const en_cours = data.filter((o) =>
          ['en_preparation', 'en_transit', 'en_livraison'].includes(o.delivery_status)
        ).length;
        setStats({
          total,
          livre,
          echec,
          retourne,
          en_cours,
          rate: total > 0 ? Math.round((livre / total) * 100) : 0,
        });

        // By wilaya
        const map = new Map<string, number>();
        data.forEach((o) => {
          if (o.wilaya) map.set(o.wilaya, (map.get(o.wilaya) || 0) + 1);
        });
        setByWilaya(
          Array.from(map.entries())
            .map(([w, n]) => ({ wilaya: w, count: n }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
        );
      }
      setLoading(false);
    };
    load();
  }, []);

  return (
    <AppLayout>
      <div className="max-w-[1120px] mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10 space-y-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-indigo-950 dark:text-stone-50">
              Rapports
            </h1>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Statistiques et analyses de vos commandes
            </p>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {[
            { label: 'Total', value: stats.total, icon: Package, color: 'blue' },
            { label: 'Livrées', value: stats.livre, icon: CheckCircle2, color: 'green' },
            { label: 'En cours', value: stats.en_cours, icon: TrendingUp, color: 'amber' },
            { label: 'Échecs', value: stats.echec, icon: XCircle, color: 'red' },
            { label: 'Retours', value: stats.retourne, icon: RotateCcw, color: 'stone' },
            {
              label: 'Taux livraison',
              value: `${stats.rate || 0}%`,
              icon: TrendingUp,
              color: 'indigo',
            },
          ].map((s) => (
            <StatCard
              key={s.label}
              icon={s.icon}
              label={s.label}
              value={s.value ?? 0}
              tone={s.color as Tone}
              loading={loading}
            />
          ))}
        </div>

        {/* Top wilayas */}
        <div className="bg-white dark:bg-stone-900 card-soft p-6">
          <h2 className="font-bold text-indigo-950 dark:text-stone-100 mb-4">Top Wilayas</h2>
          {loading ? (
            <p className="text-stone-400 dark:text-stone-500">Chargement...</p>
          ) : byWilaya.length === 0 ? (
            <p className="text-stone-400 dark:text-stone-500">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-3">
              {byWilaya.map((w, i) => (
                <div key={w.wilaya} className="flex items-center gap-3">
                  <span className="text-xs text-stone-400 dark:text-stone-500 w-4">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-stone-700 dark:text-stone-200">
                        {w.wilaya}
                      </span>
                      <span className="text-sm font-bold text-stone-900 dark:text-stone-100">
                        {w.count}
                      </span>
                    </div>
                    <div className="h-2.5 bg-violet-100/70 dark:bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                        style={{
                          width: `${Math.round((w.count / (byWilaya[0]?.count || 1)) * 100)}%`,
                        }}
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
