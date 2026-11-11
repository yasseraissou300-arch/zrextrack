'use client';

import AppLayout from '@/components/ui/AppLayout';
import { StatCard } from '@/components/ui/primitives';
import { useEffect, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  Package,
  Percent,
  RotateCcw,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { buildReport, type GroupStat, type Report } from '@/lib/reports/aggregate';

const da = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} DA`;
const num = (n: number) => n.toLocaleString('fr-FR');

// Couleur du taux de livraison : vert au-dessus de 60 %, rouge sous 40 %.
function tauxCls(taux: number | null): string {
  if (taux === null) return 'bg-stone-100 text-stone-500 dark:bg-white/[0.06] dark:text-stone-400';
  if (taux >= 60)
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  if (taux >= 40) return 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
  return 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
}

function GroupTable({
  title,
  subtitle,
  firstCol,
  rows,
  loading,
}: {
  title: string;
  subtitle: string;
  firstCol: string;
  rows: GroupStat[];
  loading: boolean;
}) {
  const max = rows[0]?.total || 1;
  return (
    <div className="bg-white dark:bg-stone-900 card-soft overflow-hidden">
      <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800">
        <h2 className="font-bold text-indigo-950 dark:text-stone-100">{title}</h2>
        <p className="text-[13px] text-stone-500 dark:text-stone-400">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[12px] font-bold uppercase tracking-wide text-violet-500/80 dark:text-violet-300/70 bg-violet-50/60 dark:bg-white/[0.03]">
            <tr>
              <th className="px-4 py-3 text-left">{firstCol}</th>
              <th className="px-4 py-3 text-right">Commandes</th>
              <th className="px-4 py-3 text-right">Livrées</th>
              <th className="px-4 py-3 text-right">Refus</th>
              <th className="px-4 py-3 text-center">Taux livraison</th>
              <th className="px-4 py-3 text-right">Encaissé</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  Chargement...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  Aucune donnée disponible
                </td>
              </tr>
            ) : (
              rows.map((g) => (
                <tr key={g.name} className="hover:bg-violet-50/50 dark:hover:bg-white/[0.04]">
                  <td className="px-4 py-3 min-w-[180px]">
                    <div className="font-bold text-indigo-950 dark:text-stone-100">{g.name}</div>
                    <div className="mt-1.5 h-1.5 bg-violet-100/70 dark:bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                        style={{ width: `${Math.round((g.total / max) * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{num(g.total)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                    {num(g.livre)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-rose-600 dark:text-rose-300">
                    {num(g.refus)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${tauxCls(g.taux)}`}
                    >
                      {g.taux === null ? '—' : `${g.taux} %`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-extrabold tabular-nums text-indigo-950 dark:text-stone-50 whitespace-nowrap">
                    {da(g.ca)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RapportsPage() {
  const [report, setReport] = useState<Report>(() => buildReport([]));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      // Via l'API (service_role + scoping session) : la lecture directe de
      // `orders` depuis le navigateur échoue (RLS 42P17).
      const res = await fetch('/api/orders/view?view=rapports');
      const { data } = (res.ok ? await res.json() : { data: null }) as { data: any[] | null };
      if (data) setReport(buildReport(data));
      setLoading(false);
    };
    load();
  }, []);

  return (
    <AppLayout>
      <div className="max-w-[1120px] mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10 space-y-6">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-indigo-950 dark:text-stone-50">
            Rapports
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Votre argent, vos retours, et d&apos;où ils viennent
          </p>
        </div>

        {/* Argent */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Banknote}
            label="Encaissé (colis livrés)"
            value={da(report.caEncaisse)}
            tone="green"
            loading={loading}
          />
          <StatCard
            icon={TrendingDown}
            label="Perdu (échecs + retours)"
            value={da(report.caPerdu)}
            tone="red"
            loading={loading}
          />
          <StatCard
            icon={TrendingUp}
            label="En cours de livraison"
            value={da(report.caEnCours)}
            tone="amber"
            loading={loading}
          />
          <StatCard
            icon={ShoppingBag}
            label="Panier moyen livré"
            value={da(report.panierMoyen)}
            tone="violet"
            loading={loading}
          />
        </div>

        {/* Volumes */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard
            icon={Package}
            label="Total"
            value={num(report.total)}
            tone="blue"
            loading={loading}
          />
          <StatCard
            icon={CheckCircle2}
            label="Livrées"
            value={num(report.livre)}
            tone="green"
            loading={loading}
          />
          <StatCard
            icon={TrendingUp}
            label="En cours"
            value={num(report.enCours)}
            tone="amber"
            loading={loading}
          />
          <StatCard
            icon={XCircle}
            label="Échecs"
            value={num(report.echec)}
            tone="red"
            loading={loading}
          />
          <StatCard
            icon={RotateCcw}
            label="Retours"
            value={num(report.retourne)}
            tone="stone"
            loading={loading}
          />
          <StatCard
            icon={Percent}
            label="Taux de livraison"
            value={`${report.tauxLivraison} %`}
            tone="indigo"
            loading={loading}
          />
        </div>
        <p className="-mt-3 text-[12.5px] text-stone-400 dark:text-stone-500">
          Taux de livraison = colis livrés ÷ colis terminés (livrés + échecs + retours). Les colis
          encore en route ne comptent pas.
        </p>

        <GroupTable
          title="Par produit"
          subtitle="Les 10 produits les plus commandés — tailles et couleurs regroupées"
          firstCol="Produit"
          rows={report.produits}
          loading={loading}
        />

        <GroupTable
          title="Par wilaya"
          subtitle="Les 15 wilayas les plus commandées — repérez celles qui refusent le plus"
          firstCol="Wilaya"
          rows={report.wilayas}
          loading={loading}
        />
      </div>
    </AppLayout>
  );
}
