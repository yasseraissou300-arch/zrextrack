'use client';

import AppLayout from '@/components/ui/AppLayout';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Repeat, Search, CheckCircle2, AlertTriangle, MapPin, TrendingUp,
  Package, Filter, Loader2, ExternalLink, Info, Truck, XCircle,
  Settings as SettingsIcon, Plus, Trash2, Save, BarChart3, X, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MatchProposal, PreviewResponse, Confidence } from '@/lib/autoswap/types';
import { loadSyncSettings } from '@/lib/sync-settings-client';

// ZRExpress restreint l'exécution des swaps via API key (403 ApiKeyNotAllowed).
// AutoTim agit donc comme un copilote : il identifie les matchs et facilite
// l'exécution manuelle dans l'UI ZRExpress avec liens directs et copie d'infos.
//
// L'UI ZRExpress affiche la fiche d'un colis (avec bouton « Swap ») via :
//   https://app.zrexpress.app/parcels/default/{parcelUuid}
const parcelDetailUrl = (parcelUuid: string) =>
  `https://app.zrexpress.app/parcels/default/${parcelUuid}`;

const CONFIDENCE_META: Record<Confidence, { label: string; bg: string; text: string; border: string }> = {
  EXACT:  { label: 'Exact',  bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  STRONG: { label: 'Confirmé', bg: 'bg-blue-50', text: 'text-blue-700',  border: 'border-blue-200' },
  WEAK:   { label: 'À vérifier', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
};

type SwapBucket = 'delivered' | 'cancelled' | 'in_progress';

interface SwappedItem {
  id: string;
  tracking: string;
  customer: string;
  wilaya: string;
  state_raw: string;
  situation_raw: string;
  bucket: SwapBucket;
  swap_count: number;
  swapped_at: string | null;
}

interface SwapStats {
  total_swapped: number;
  delivered: number;
  cancelled: number;
  in_progress: number;
  delivery_rate: number;
  items: SwappedItem[];
}

export default function AutoSwapPage() {
  const [token, setToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [credentialsReady, setCredentialsReady] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filterConfidence, setFilterConfidence] = useState<'ALL' | Confidence>('ALL');
  const [onlySameCity, setOnlySameCity] = useState(false);

  const [swapStats, setSwapStats] = useState<SwapStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  // Bucket cliqué pour afficher le détail (null = aucun, 'all' = tout)
  const [openBucket, setOpenBucket] = useState<SwapBucket | 'all' | null>(null);
  // Période affichée — Aujourd'hui par défaut
  const [period, setPeriod] = useState<'today' | '7days'>('today');

  // Filtre les commandes swappées par date de swap (swapped_at) selon la période,
  // et recalcule les compteurs côté client (pas besoin de re-appeler l'API).
  const periodStats = useMemo(() => {
    const empty = { total_swapped: 0, delivered: 0, cancelled: 0, in_progress: 0, delivery_rate: 0, items: [] as SwappedItem[] };
    if (!swapStats) return empty;
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const start7 = startToday - 6 * 24 * 60 * 60 * 1000; // 7 jours glissants (aujourd'hui inclus)
    const items = swapStats.items.filter(it => {
      if (!it.swapped_at) return false; // sans date → non rattachable à une période
      const t = new Date(it.swapped_at).getTime();
      if (Number.isNaN(t)) return false;
      return period === 'today' ? t >= startToday : t >= start7;
    });
    const delivered = items.filter(i => i.bucket === 'delivered').length;
    const cancelled = items.filter(i => i.bucket === 'cancelled').length;
    const in_progress = items.filter(i => i.bucket === 'in_progress').length;
    const finalized = delivered + cancelled;
    const delivery_rate = finalized > 0 ? Math.round((delivered / finalized) * 1000) / 10 : 0;
    return { total_swapped: items.length, delivered, cancelled, in_progress, delivery_rate, items };
  }, [swapStats, period]);

  // Charge les stats des commandes DÉJÀ swappées directement depuis ZRExpress
  // (détection automatique via swap.count) — nécessite les credentials.
  const fetchSwapStats = useCallback(async (tk: string, ti: string) => {
    if (!tk || !ti) { setStatsLoading(false); return; }
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch('/api/autoswap/swapped-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tk, tenantId: ti }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.ok) {
        setSwapStats(json as SwapStats);
      } else {
        setStatsError((json as { error?: string }).error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Erreur réseau');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSyncSettings().then(s => {
      setToken(s.zrexpress_token);
      setTenantId(s.zrexpress_tenant_id);
      setCredentialsReady(!!s.zrexpress_token && !!s.zrexpress_tenant_id);
      // Charge les stats dès que les credentials sont disponibles
      fetchSwapStats(s.zrexpress_token, s.zrexpress_tenant_id);
    });
  }, [fetchSwapStats]);

  const runScan = async () => {
    if (!credentialsReady) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/autoswap/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, tenantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setPreview(data as PreviewResponse);
    } catch (err: any) {
      setError(err.message);
      setPreview(null);
    } finally {
      setScanning(false);
    }
  };

  const proposalKey = (p: MatchProposal) => `${p.swappable.id}::${p.target.id}`;

  const filteredProposals: MatchProposal[] = useMemo(() => {
    if (!preview) return [];
    return preview.proposals.filter(p => {
      if (filterConfidence !== 'ALL' && p.confidence !== filterConfidence) return false;
      if (onlySameCity && !p.same_city) return false;
      return true;
    });
  }, [preview, filterConfidence, onlySameCity]);

  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex items-center justify-center shadow-sm shadow-violet-500/25">
            <Repeat size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 tracking-tight">AutoSwap</h1>
            <p className="text-sm text-stone-500 dark:text-stone-400 dark:text-stone-500">Détecte les swaps possibles et facilite l'exécution dans ZRExpress</p>
          </div>
        </div>

        {/* Info banner — workflow explanation */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <strong>Mode copilote :</strong> ZRExpress n'autorise pas encore l'exécution des swaps via API externe.
            AutoTim trouve les matchs (produit + couleur + taille + quantité identiques) et te donne pour chaque match
            <strong> deux liens directs</strong> : l'ancien colis et la nouvelle commande. Tu les ouvres côte à côte dans ZRExpress
            et tu valides le swap.
          </div>
        </div>

        {/* Credentials check */}
        {!credentialsReady && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <AlertTriangle className="inline-block mr-2" size={16} />
            Aucune clé API ZRExpress trouvée. Configurez-la d'abord sur la page <a href="/sync" className="underline font-medium">Sync</a>.
          </div>
        )}

        {/* Statistiques des commandes swappées — focus livré vs annulé */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800 p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-gray-500 dark:text-stone-400" />
              <h2 className="font-semibold text-gray-900 dark:text-stone-100">Statistiques des commandes swappées</h2>
            </div>
            <div className="flex items-center gap-3">
              {/* Sélecteur de période — Aujourd'hui par défaut */}
              <div className="inline-flex bg-stone-100 dark:bg-stone-800 rounded-lg p-0.5">
                <button
                  onClick={() => { setPeriod('today'); setOpenBucket(null); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${period === 'today' ? 'bg-white dark:bg-stone-900 text-violet-700 dark:text-violet-300 shadow-sm' : 'text-stone-500 dark:text-stone-400'}`}
                >
                  Aujourd'hui
                </button>
                <button
                  onClick={() => { setPeriod('7days'); setOpenBucket(null); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${period === '7days' ? 'bg-white dark:bg-stone-900 text-violet-700 dark:text-violet-300 shadow-sm' : 'text-stone-500 dark:text-stone-400'}`}
                >
                  7 derniers jours
                </button>
              </div>
              <button
                onClick={() => fetchSwapStats(token, tenantId)}
                disabled={statsLoading || !credentialsReady}
                className="text-xs text-gray-500 dark:text-stone-400 hover:text-gray-700 dark:text-stone-200 flex items-center gap-1.5 disabled:opacity-50"
                title="Rafraîchir les statistiques"
              >
                <Loader2 size={12} className={statsLoading ? 'animate-spin' : 'opacity-0'} />
                Rafraîchir
              </button>
            </div>
          </div>

          {!credentialsReady ? (
            <div className="text-sm text-gray-500 dark:text-stone-400 py-2">
              Configurez votre clé API ZRExpress sur la page <a href="/sync" className="underline font-medium">Sync</a> pour voir les statistiques.
            </div>
          ) : statsError ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <strong>Erreur :</strong> {statsError}
            </div>
          ) : statsLoading && !swapStats ? (
            <div className="text-sm text-gray-400 dark:text-stone-500 py-2">Analyse des commandes swappées…</div>
          ) : swapStats && swapStats.total_swapped === 0 ? (
            <div className="text-sm text-gray-500 dark:text-stone-400 py-2">
              Aucune commande swappée trouvée dans votre compte ZRExpress.
            </div>
          ) : swapStats ? (
            <>
              <p className="text-xs text-gray-400 dark:text-stone-500 -mt-1">
                Commandes swappées {period === 'today' ? "aujourd'hui" : 'sur les 7 derniers jours'}, classées par statut de livraison.
                <span className="text-gray-300 dark:text-stone-600"> · Cliquez une carte pour voir le détail.</span>
              </p>

              {/* Carrés principaux — cliquables pour afficher le détail */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  icon={<Repeat size={18} />}
                  label="Total swappées"
                  value={periodStats.total_swapped}
                  color="purple"
                  active={openBucket === 'all'}
                  onClick={() => setOpenBucket(b => b === 'all' ? null : 'all')}
                />
                <StatCard
                  icon={<CheckCircle2 size={18} />}
                  label="Livrées"
                  value={periodStats.delivered}
                  color="green"
                  active={openBucket === 'delivered'}
                  onClick={() => setOpenBucket(b => b === 'delivered' ? null : 'delivered')}
                />
                <StatCard
                  icon={<XCircle size={18} />}
                  label="Annulées"
                  value={periodStats.cancelled}
                  color="red"
                  active={openBucket === 'cancelled'}
                  onClick={() => setOpenBucket(b => b === 'cancelled' ? null : 'cancelled')}
                />
                <StatCard
                  icon={<Truck size={18} />}
                  label="En cours"
                  value={periodStats.in_progress}
                  color="blue"
                  active={openBucket === 'in_progress'}
                  onClick={() => setOpenBucket(b => b === 'in_progress' ? null : 'in_progress')}
                />
              </div>

              {/* Message si aucune commande dans la période choisie */}
              {periodStats.total_swapped === 0 && (
                <div className="text-sm text-gray-500 dark:text-stone-400 py-1">
                  Aucune commande swappée {period === 'today' ? "aujourd'hui" : 'sur les 7 derniers jours'}.
                  {period === 'today' && <span className="text-gray-400 dark:text-stone-500"> Essayez « 7 derniers jours ».</span>}
                </div>
              )}

              {/* Détail du bucket sélectionné */}
              {openBucket && (
                <SwappedDetailList
                  items={periodStats.items.filter(it => openBucket === 'all' || it.bucket === openBucket)}
                  bucket={openBucket}
                  onClose={() => setOpenBucket(null)}
                />
              )}

              {/* Bandeau résumé — taux de livraison */}
              <div className="pt-3 border-t border-stone-100 dark:border-stone-800">
                <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 text-sm">
                    <TrendingUp size={14} className="text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-900 dark:text-emerald-300 font-medium">Taux de livraison des swaps</span>
                  </div>
                  <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                    {periodStats.delivery_rate}%
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-red-600 py-2">Impossible de charger les statistiques.</div>
          )}
        </div>

        {/* Scan action */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800 p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-stone-100">Scanner les opportunités de swap</h2>
              <p className="text-sm text-gray-500 dark:text-stone-400 mt-1">Récupère tous les colis ZRExpress et détecte les matchs stricts (produit + couleur + taille).</p>
            </div>
            <button
              onClick={runScan}
              disabled={scanning || !credentialsReady}
              className="flex items-center gap-2 bg-gradient-to-br from-violet-500 to-fuchsia-500 hover:shadow-lg hover:shadow-violet-500/30 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-xl transition-all active:scale-95 shadow-md shadow-violet-500/20"
            >
              {scanning ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              {scanning ? 'Analyse en cours…' : 'Scanner pour swaps'}
            </button>
          </div>
        </div>

        {/* Équivalences de tailles personnalisées */}
        <SizeEquivalencesCard />


        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <strong>Erreur :</strong> {error}
          </div>
        )}

        {/* Stats */}
        {preview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={<Package size={18} />} label="Colis swappables" value={preview.stats.total_swappable} color="amber" />
            <StatCard icon={<Package size={18} />} label="Commandes en attente" value={preview.stats.total_targets} color="blue" />
            <StatCard icon={<CheckCircle2 size={18} />} label="Matchs détectés" value={preview.stats.matches_count} color="purple" />
            <StatCard icon={<TrendingUp size={18} />} label="Économies estimées" value={`${preview.stats.total_savings.toFixed(0)} DA`} color="green" />
          </div>
        )}

        {/* Filters */}
        {preview && preview.proposals.length > 0 && (
          <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800 p-4 flex items-center gap-3 flex-wrap">
            <Filter size={16} className="text-gray-400 dark:text-stone-500" />
            <select
              value={filterConfidence}
              onChange={e => setFilterConfidence(e.target.value as 'ALL' | Confidence)}
              className="text-sm border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-1.5"
            >
              <option value="ALL">Tous les matchs ({preview.stats.matches_count})</option>
              <option value="EXACT">Exact UUID ({preview.stats.by_confidence.EXACT})</option>
              <option value="STRONG">Couleur + taille confirmées ({preview.stats.by_confidence.STRONG})</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-stone-200">
              <input type="checkbox" checked={onlySameCity} onChange={e => setOnlySameCity(e.target.checked)} />
              Même ville uniquement
            </label>
          </div>
        )}

        {/* Proposals table */}
        {preview && (
          preview.proposals.length === 0 ? (
            <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800 p-12 text-center">
              <Package size={36} className="mx-auto text-gray-300 dark:text-stone-600 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-stone-100 mb-1">Aucun match trouvé</h3>
              <p className="text-sm text-gray-500 dark:text-stone-400">
                {preview.stats.total_swappable} colis swappable{preview.stats.total_swappable > 1 ? 's' : ''} ·
                {' '}{preview.stats.total_targets} commande{preview.stats.total_targets > 1 ? 's' : ''} en attente.
                <br />Aucune correspondance produit + couleur + taille détectée.
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 border-b border-stone-100 dark:border-stone-800">
                    <tr className="text-left text-gray-600 dark:text-stone-300">
                      <th className="px-4 py-3">Colis à rediriger</th>
                      <th className="px-4 py-3">→ Nouveau client</th>
                      <th className="px-4 py-3">Produit · Variante</th>
                      <th className="px-4 py-3">Wilaya</th>
                      <th className="px-4 py-3 text-right">Économie</th>
                      <th className="px-4 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                    {filteredProposals.map((p) => {
                      const key = proposalKey(p);
                      const meta = CONFIDENCE_META[p.confidence];
                      return (
                        <tr key={key} className="hover:bg-stone-50 dark:hover:bg-stone-800 align-top">
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs text-gray-900 dark:text-stone-100">{p.swappable.tracking}</div>
                            <div className="text-xs text-gray-500 dark:text-stone-400 mt-0.5">{p.swappable.customer || '—'}</div>
                            <span className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${meta.bg} ${meta.text} ${meta.border}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-stone-100">{p.target.customer || '—'}</div>
                            <div className="text-xs text-gray-500 dark:text-stone-400">{p.target.customerPhone}</div>
                            <div className="font-mono text-[10px] text-gray-400 dark:text-stone-500 mt-0.5">{p.target.tracking}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-gray-900 dark:text-stone-100">{p.swappable.product}</div>
                            <div className="text-xs text-gray-500 dark:text-stone-400">
                              {p.swappable.variantColor && `${p.swappable.variantColor}`}
                              {p.swappable.variantSize && ` · T.${p.swappable.variantSize}`}
                              {p.swappable.quantity > 1 && ` · ${p.swappable.quantity}×`}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-gray-900 dark:text-stone-100 text-xs">
                              <MapPin size={11} className={p.same_city ? 'text-green-600' : 'text-gray-400 dark:text-stone-500'} />
                              {p.swappable.city}
                            </div>
                            {!p.same_city && (
                              <div className="text-[10px] text-gray-400 dark:text-stone-500 mt-0.5">→ {p.target.city}</div>
                            )}
                            {p.same_city && (
                              <div className="text-[10px] text-green-600 mt-0.5">✓ même ville</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-green-700">
                            +{p.estimated_savings.toFixed(0)} DA
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1 items-stretch min-w-[180px]">
                              <a
                                href={parcelDetailUrl(p.swappable.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white font-medium px-3 py-1.5 rounded-md transition-colors"
                                title="Ouvre la fiche du colis à rediriger dans ZRExpress"
                              >
                                <ExternalLink size={12} />
                                Voir l'ancien colis
                              </a>
                              <a
                                href={parcelDetailUrl(p.target.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 py-1.5 rounded-md transition-colors"
                                title="Ouvre la fiche de la nouvelle commande dans ZRExpress"
                              >
                                <ExternalLink size={12} />
                                Voir la nouvelle commande
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredProposals.length === 0 && (
                <div className="text-center py-8 text-sm text-gray-500 dark:text-stone-400">
                  Aucune proposition ne correspond aux filtres actuels.
                </div>
              )}
            </div>
          )
        )}

      </div>
    </AppLayout>
  );
}

function StatCard({ icon, label, value, color, onClick, active }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: 'amber' | 'blue' | 'purple' | 'green' | 'red';
  onClick?: () => void;
  active?: boolean;
}) {
  const palette: Record<string, string> = {
    amber:  'bg-amber-50 text-amber-700',
    blue:   'bg-blue-50 text-blue-700',
    purple: 'bg-purple-50 text-purple-700',
    green:  'bg-green-50 text-green-700',
    red:    'bg-red-50 text-red-700',
  };
  const ringByColor: Record<string, string> = {
    amber: 'ring-amber-400', blue: 'ring-blue-400', purple: 'ring-purple-400',
    green: 'ring-green-400', red: 'ring-red-400',
  };
  const interactive = !!onClick;
  return (
    <div
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } } : undefined}
      className={`bg-white dark:bg-stone-900 rounded-2xl shadow-sm border p-4 transition-all ${
        interactive ? 'cursor-pointer hover:shadow-md hover:border-stone-300 dark:hover:border-stone-600 active:scale-[0.98]' : ''
      } ${active ? `ring-2 ${ringByColor[color]} border-transparent` : 'border-stone-100 dark:border-stone-800'}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${palette[color]}`}>{icon}</div>
        <span className="text-xs text-gray-500 dark:text-stone-400">{label}</span>
        {interactive && <ChevronRight size={13} className={`ml-auto text-gray-300 dark:text-stone-600 transition-transform ${active ? 'rotate-90' : ''}`} />}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-stone-100">{value}</div>
    </div>
  );
}

// Tableau de détail des colis swappés pour un bucket donné. Chaque ligne a un
// lien direct vers la fiche ZRExpress pour vérifier le statut réel.
function SwappedDetailList({ items, bucket, onClose }: {
  items: SwappedItem[];
  bucket: SwapBucket | 'all';
  onClose: () => void;
}) {
  const title: Record<string, string> = {
    all: 'Toutes les commandes swappées',
    delivered: 'Commandes swappées livrées',
    cancelled: 'Commandes swappées annulées',
    in_progress: 'Commandes swappées en cours',
  };
  return (
    <div className="border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-stone-50 dark:bg-stone-800/50 border-b border-stone-100 dark:border-stone-800">
        <span className="text-sm font-medium text-gray-700 dark:text-stone-200">
          {title[bucket]} <span className="text-gray-400 dark:text-stone-500">({items.length})</span>
        </span>
        <button onClick={onClose} className="text-gray-400 dark:text-stone-500 hover:text-gray-700 dark:hover:text-stone-200" title="Fermer">
          <X size={15} />
        </button>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-stone-500">Aucune commande dans cette catégorie.</div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-white dark:bg-stone-900 sticky top-0 border-b border-stone-100 dark:border-stone-800">
              <tr className="text-left text-gray-500 dark:text-stone-400">
                <th className="px-4 py-2 font-medium">Tracking</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Wilaya</th>
                <th className="px-4 py-2 font-medium">Statut livraison</th>
                <th className="px-4 py-2 font-medium text-center">Swaps</th>
                <th className="px-4 py-2 font-medium text-center">Vérifier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {items.map((it, i) => (
                <tr key={`${it.id}-${i}`} className="hover:bg-stone-50 dark:hover:bg-stone-800/50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-900 dark:text-stone-100">{it.tracking || '—'}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-stone-200">{it.customer || '—'}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-stone-300">{it.wilaya || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="text-gray-800 dark:text-stone-100">{it.state_raw || '—'}</div>
                    {it.situation_raw && (
                      <div className="text-[10px] text-gray-400 dark:text-stone-500">situation : {it.situation_raw}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center text-gray-500 dark:text-stone-400">{it.swap_count}</td>
                  <td className="px-4 py-2 text-center">
                    {it.id ? (
                      <a
                        href={`https://app.zrexpress.app/parcels/default/${it.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400"
                        title="Ouvrir la fiche dans ZRExpress"
                      >
                        <ExternalLink size={12} /> Ouvrir
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Équivalences de tailles (multi-tenant) ──────────────────────────────────
// Permet à chaque utilisateur de configurer ses propres groupes de tailles
// interchangeables par produit. Ex : pour ses hijabs, l'utilisateur décide que
// 40/42/44 sont équivalents pour le matching de swap.

interface Equivalence {
  id: string;
  product_key: string;
  product_label: string | null;
  groups: string[][];
}

function SizeEquivalencesCard() {
  const [items, setItems] = useState<Equivalence[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newGroupsText, setNewGroupsText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/autoswap/equivalences');
    const json = await res.json();
    setItems(json.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addNew = async () => {
    if (!newKey.trim() || !newGroupsText.trim()) {
      toast.error('Saisis la clé produit + au moins un groupe de tailles');
      return;
    }
    // Parse les groupes : 1 ligne par groupe, tailles séparées par virgule
    // ex : "40, 42, 44\n46, 48, 50"
    const groups = newGroupsText
      .split('\n')
      .map(line => line.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean))
      .filter(g => g.length >= 2);

    if (groups.length === 0) {
      toast.error('Chaque groupe doit contenir au moins 2 tailles');
      return;
    }

    setSaving(true);
    const res = await fetch('/api/autoswap/equivalences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_key: newKey.trim(),
        product_label: newLabel.trim() || undefined,
        groups,
      }),
    });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else {
      toast.success('Produit enregistré');
      setNewKey(''); setNewLabel(''); setNewGroupsText('');
      load();
    }
    setSaving(false);
  };

  const remove = async (key: string) => {
    if (!confirm(`Supprimer les équivalences pour « ${key} » ?`)) return;
    const res = await fetch(`/api/autoswap/equivalences?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.error) toast.error(json.error);
    else { toast.success('Supprimé'); load(); }
  };

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full p-4 flex items-center gap-3 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
          <SettingsIcon size={16} className="text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-gray-900 dark:text-stone-100 text-sm">Mes équivalences de tailles</h2>
          <p className="text-xs text-gray-500 dark:text-stone-400 mt-0.5">
            {items.length === 0
              ? 'Aucun produit configuré — utilise les défauts ou ajoute les tiens'
              : `${items.length} produit${items.length > 1 ? 's' : ''} configuré${items.length > 1 ? 's' : ''} — utilisés pour matcher des tailles interchangeables`}
          </p>
        </div>
        <span className="text-xs text-stone-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-stone-100 dark:border-stone-800 p-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin text-stone-400" size={18} /></div>
          ) : (
            <>
              {/* État vide : message générique, pas de fuite de produits */}
              {items.length === 0 && (
                <div className="bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl p-4 text-sm text-stone-700 dark:text-stone-200">
                  <p className="font-medium">Aucun produit configuré.</p>
                  <p className="text-xs mt-1 text-stone-500 dark:text-stone-400">
                    Ajoute ci-dessous les produits pour lesquels certaines tailles sont interchangeables.
                    Sans configuration, AutoSwap matche les tailles à l'identique strict (un colis taille 42
                    ne matchera qu'une commande taille 42).
                  </p>
                </div>
              )}

              {/* Liste des équivalences existantes */}
              {items.length > 0 && (
                <div className="space-y-2">
                  {items.map(item => (
                    <div key={item.id} className="flex items-start gap-3 p-3 bg-stone-50 dark:bg-stone-800 rounded-xl">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm text-gray-900 dark:text-stone-100">{item.product_label || item.product_key}</span>
                          <code className="text-[10px] font-mono bg-white dark:bg-stone-900 px-1.5 py-0.5 rounded text-stone-500">{item.product_key}</code>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.groups.map((g, i) => (
                            <span key={i} className="text-[11px] bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-md font-medium">
                              {g.join(' · ')}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => remove(item.product_key)}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Supprimer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Formulaire d'ajout */}
              <div className="border-t border-stone-100 dark:border-stone-800 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2 flex items-center gap-1.5">
                  <Plus size={12} />
                  Ajouter un produit
                </h3>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    placeholder="Clé produit (SKU ou nom, ex : « mrl » ou « hijab miral »)"
                    className="w-full px-3 py-2 text-sm border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  />
                  <input
                    type="text"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    placeholder="Nom lisible (optionnel, ex : « Hijab Miral »)"
                    className="w-full px-3 py-2 text-sm border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  />
                  <textarea
                    value={newGroupsText}
                    onChange={e => setNewGroupsText(e.target.value)}
                    rows={3}
                    placeholder={'Groupes de tailles équivalentes — 1 ligne par groupe, virgules entre tailles\n\nExemple :\n40, 42, 44\n46, 48, 50'}
                    className="w-full px-3 py-2 text-sm font-mono border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  />
                  <button
                    onClick={addNew}
                    disabled={saving || !newKey.trim() || !newGroupsText.trim()}
                    className="flex items-center gap-1.5 text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-medium rounded-lg disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Enregistrer
                  </button>
                </div>
                <p className="text-[10px] text-stone-400 mt-2">
                  💡 La clé doit correspondre au SKU détecté dans <code>productsDescription</code> (ex : <code>mrl</code>) ou au nom normalisé du produit (ex : <code>hijab miral</code>). Le matcher essaie les 2.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
