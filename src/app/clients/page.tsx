'use client';

import AppLayout from '@/components/ui/AppLayout';
import { StatCard } from '@/components/ui/primitives';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Heart, Search, ShieldAlert, Users } from 'lucide-react';
import {
  activeOrdersOfRiskyClients,
  buildClientStats,
  type ActiveRiskyOrder,
  type ClientStats,
  type RiskLevel,
} from '@/lib/clients/risk';

const LEVEL: Record<RiskLevel, { label: string; cls: string }> = {
  fidele: {
    label: 'Fidèle',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  bon: { label: 'Bon', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  nouveau: {
    label: 'Nouveau',
    cls: 'bg-stone-100 text-stone-600 dark:bg-white/[0.06] dark:text-stone-300',
  },
  surveiller: {
    label: 'À surveiller',
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  risque: {
    label: 'À risque',
    cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
};

type Filter = 'tous' | RiskLevel;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'tous', label: 'Tous' },
  { id: 'risque', label: 'À risque' },
  { id: 'surveiller', label: 'À surveiller' },
  { id: 'fidele', label: 'Fidèles' },
];

// Au-delà, le tableau gèle la page (plusieurs milliers de clients).
const MAX_ROWS = 200;
const da = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} DA`;

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientStats[]>([]);
  const [risky, setRisky] = useState<ActiveRiskyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('tous');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const fetchClients = async () => {
      setLoading(true);
      // Via l'API (service_role + scoping session) : la lecture directe de
      // `orders` depuis le navigateur échoue (RLS 42P17).
      const res = await fetch('/api/orders/view?view=clients');
      const { data } = (res.ok ? await res.json() : { data: null }) as { data: any[] | null };
      if (data) {
        const stats = buildClientStats(data);
        setClients(stats);
        setRisky(activeOrdersOfRiskyClients(data, stats));
      }
      setLoading(false);
    };
    fetchClients();
  }, []);

  const counts = useMemo(() => {
    const c = { risque: 0, surveiller: 0, fidele: 0 };
    for (const x of clients) if (x.level in c) c[x.level as keyof typeof c]++;
    return c;
  }, [clients]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return clients.filter((c) => {
      if (filter !== 'tous' && c.level !== filter) return false;
      if (!q) return true;
      if (c.client.toLowerCase().includes(q)) return true;
      return digits.length >= 3 && c.whatsapp.replace(/\D/g, '').includes(digits);
    });
  }, [clients, filter, query]);

  return (
    <AppLayout>
      <div className="max-w-[1120px] mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10 space-y-6">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-indigo-950 dark:text-stone-50">
            Clients
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Score de fiabilité calculé sur l&apos;historique de chaque client
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Users}
            label="Clients"
            value={clients.length.toLocaleString('fr-FR')}
            tone="violet"
            loading={loading}
          />
          <StatCard
            icon={Heart}
            label="Fidèles"
            value={counts.fidele.toLocaleString('fr-FR')}
            tone="green"
            loading={loading}
          />
          <StatCard
            icon={AlertTriangle}
            label="À surveiller"
            value={counts.surveiller.toLocaleString('fr-FR')}
            tone="amber"
            loading={loading}
          />
          <StatCard
            icon={ShieldAlert}
            label="À risque"
            value={counts.risque.toLocaleString('fr-FR')}
            tone="red"
            loading={loading}
          />
        </div>

        {/* Commandes encore en cours de clients qui refusent leurs colis */}
        {!loading && risky.length > 0 && (
          <div className="card-soft bg-rose-50 dark:bg-rose-500/10 p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl grid place-items-center bg-white dark:bg-white/10 text-rose-600 dark:text-rose-300 shrink-0">
                <ShieldAlert size={19} />
              </div>
              <div>
                <h2 className="font-extrabold text-rose-900 dark:text-rose-100">
                  {risky.length} commande{risky.length > 1 ? 's' : ''} en cours chez des clients à
                  risque
                </h2>
                <p className="text-[13px] text-rose-800/80 dark:text-rose-200/80">
                  Ces clients ont déjà refusé plusieurs colis. Appelez-les pour confirmer avant que
                  le colis parte.
                </p>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {risky.slice(0, 20).map((r) => (
                <li
                  key={r.tracking_number}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-white dark:bg-stone-900 px-4 py-2.5 text-[13.5px]"
                >
                  <span className="font-bold text-indigo-950 dark:text-stone-50">{r.client}</span>
                  <span className="text-stone-500 dark:text-stone-400">{r.whatsapp || '—'}</span>
                  <span className="text-stone-500 dark:text-stone-400">{r.wilaya || '—'}</span>
                  <span className="font-mono text-[12px] text-stone-400">{r.tracking_number}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="rounded-full bg-rose-50 dark:bg-rose-500/15 px-2.5 py-0.5 text-[12px] font-bold text-rose-700 dark:text-rose-300">
                      {r.refus} refus · {r.livre} livré{r.livre > 1 ? 's' : ''}
                    </span>
                    <span className="font-extrabold text-indigo-950 dark:text-stone-50">
                      {da(r.cod)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {risky.length > 20 && (
              <p className="mt-3 text-[12.5px] text-rose-800/70 dark:text-rose-200/70">
                20 premières sur {risky.length}.
              </p>
            )}
          </div>
        )}

        <div className="bg-white dark:bg-stone-900 card-soft overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800 flex flex-wrap items-center gap-3">
            <h2 className="font-bold text-indigo-950 dark:text-stone-100">
              Liste clients ({shown.length.toLocaleString('fr-FR')})
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 rounded-full text-[12.5px] font-bold transition-colors ${
                    filter === f.id
                      ? 'btn-brand'
                      : 'bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-white/[0.06] dark:text-violet-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className="ml-auto relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nom ou téléphone"
                className="h-9 w-56 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 pl-9 pr-3 text-[13.5px] text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[12px] font-bold uppercase tracking-wide text-violet-500/80 dark:text-violet-300/70 bg-violet-50/60 dark:bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-left">WhatsApp</th>
                  <th className="px-4 py-3 text-left">Wilaya</th>
                  <th className="px-4 py-3 text-center">Commandes</th>
                  <th className="px-4 py-3 text-center">Livrées</th>
                  <th className="px-4 py-3 text-center">Refus</th>
                  <th className="px-4 py-3 text-right">Encaissé</th>
                  <th className="px-4 py-3 text-left">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                {loading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-stone-400 dark:text-stone-500"
                    >
                      Chargement...
                    </td>
                  </tr>
                ) : shown.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-stone-400 dark:text-stone-500"
                    >
                      {clients.length === 0
                        ? "Aucun client — ajoutez des commandes d'abord"
                        : 'Aucun client ne correspond'}
                    </td>
                  </tr>
                ) : (
                  shown.slice(0, MAX_ROWS).map((c) => (
                    <tr key={c.key} className="hover:bg-violet-50/50 dark:hover:bg-white/[0.04]">
                      <td className="px-4 py-3 font-bold text-indigo-950 dark:text-stone-100">
                        {c.client || '—'}
                      </td>
                      <td className="px-4 py-3 text-stone-500 dark:text-stone-400">
                        {c.whatsapp || '—'}
                      </td>
                      <td className="px-4 py-3 text-stone-500 dark:text-stone-400">
                        {c.wilaya || '—'}
                      </td>
                      <td className="px-4 py-3 text-center font-bold tabular-nums">{c.total}</td>
                      <td className="px-4 py-3 text-center font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                        {c.livre}
                      </td>
                      <td className="px-4 py-3 text-center font-bold tabular-nums text-rose-600 dark:text-rose-300">
                        {c.refus}
                      </td>
                      <td className="px-4 py-3 text-right font-extrabold tabular-nums text-indigo-950 dark:text-stone-50 whitespace-nowrap">
                        {c.caLivre > 0 ? da(c.caLivre) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[12px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${LEVEL[c.level].cls}`}
                        >
                          {LEVEL[c.level].label}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {shown.length > MAX_ROWS && (
            <div className="px-6 py-4 border-t border-stone-100 dark:border-stone-800 text-[13px] text-stone-500">
              {MAX_ROWS} premiers sur {shown.length.toLocaleString('fr-FR')} — utilisez la recherche
              pour trouver un client.
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
