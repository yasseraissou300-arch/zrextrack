'use client';

import AppLayout from '@/components/ui/AppLayout';
import { useEffect, useMemo, useState } from 'react';
import {
  Repeat, Search, CheckCircle2, AlertTriangle, MapPin, TrendingUp,
  Package, Filter, Loader2, ExternalLink, Info, Truck, XCircle, History,
} from 'lucide-react';
import type { MatchProposal, PreviewResponse, Confidence } from '@/lib/autoswap/types';

const STORAGE_KEY = 'zrexpress_token';
const TENANT_KEY = 'zrexpress_tenant';

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

interface SwapStats {
  total_swaps: number;
  delivered: number;
  failed: number;
  in_progress: number;
  unknown: number;
  delivery_rate: number;
  total_savings: number;
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

  useEffect(() => {
    const t = localStorage.getItem(STORAGE_KEY) || '';
    const ti = localStorage.getItem(TENANT_KEY) || '';
    setToken(t);
    setTenantId(ti);
    setCredentialsReady(!!t && !!ti);
  }, []);

  const fetchSwapStats = async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch('/api/autoswap/stats');
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.ok) {
        setSwapStats(json as SwapStats);
      } else {
        const errMsg = (json as { error?: string; code?: string }).error || `HTTP ${res.status}`;
        const code = (json as { code?: string }).code;
        setStatsError(code ? `${errMsg} (code ${code})` : errMsg);
      }
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Erreur réseau');
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchSwapStats();
  }, []);

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

  const filteredProposals: MatchProposal[] = useMemo(() => {
    if (!preview) return [];
    return preview.proposals.filter(p => {
      if (filterConfidence !== 'ALL' && p.confidence !== filterConfidence) return false;
      if (onlySameCity && !p.same_city) return false;
      return true;
    });
  }, [preview, filterConfidence, onlySameCity]);

  const proposalKey = (p: MatchProposal) => `${p.swappable.id}::${p.target.id}`;

  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-md shadow-violet-500/25">
            <Repeat size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-stone-900 tracking-tight">AutoSwap</h1>
            <p className="text-sm text-stone-500">Détecte les swaps possibles et facilite l'exécution dans ZRExpress</p>
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

        {/* Historique des swaps — stats cumulatives */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-900">Historique des swaps</h2>
            </div>
            <button
              onClick={fetchSwapStats}
              disabled={statsLoading}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1.5 disabled:opacity-50"
              title="Rafraîchir les statistiques"
            >
              {statsLoading ? <Loader2 size={12} className="animate-spin" /> : <Loader2 size={12} className="opacity-0" />}
              Rafraîchir
            </button>
          </div>

          {statsError ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <strong>Erreur :</strong> {statsError}
              {/relation.*autoswap_log.*does not exist/i.test(statsError) && (
                <p className="mt-1 text-xs text-red-600">
                  La table <code>autoswap_log</code> n'existe pas. Exécute le fichier <code>supabase_autoswap.sql</code> dans Supabase → SQL Editor.
                </p>
              )}
            </div>
          ) : statsLoading && !swapStats ? (
            <div className="text-sm text-gray-400 py-2">Chargement des statistiques…</div>
          ) : swapStats && swapStats.total_swaps === 0 ? (
            <div className="text-sm text-gray-500 py-2">
              Aucun swap exécuté pour le moment. Lance un scan ci-dessous pour détecter les opportunités.
            </div>
          ) : swapStats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={<Repeat size={18} />} label="Commandes swappées" value={swapStats.total_swaps} color="purple" />
                <StatCard icon={<CheckCircle2 size={18} />} label="Livrées" value={swapStats.delivered} color="green" />
                <StatCard icon={<TrendingUp size={18} />} label="Taux de livraison" value={`${swapStats.delivery_rate}%`} color="blue" />
                <StatCard icon={<TrendingUp size={18} />} label="Économies cumulées" value={`${Math.round(swapStats.total_savings)} DA`} color="amber" />
              </div>

              {/* Sous-répartition par état */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-stone-100">
                <BreakdownItem icon={<Truck size={12} />} label="En cours" value={swapStats.in_progress} color="text-blue-700 bg-blue-50" />
                <BreakdownItem icon={<XCircle size={12} />} label="Échec / retour" value={swapStats.failed} color="text-red-700 bg-red-50" />
                <BreakdownItem icon={<Info size={12} />} label="Statut inconnu" value={swapStats.unknown} color="text-gray-600 bg-stone-50" />
                <BreakdownItem icon={<CheckCircle2 size={12} />} label="Livrées" value={swapStats.delivered} color="text-green-700 bg-green-50" />
              </div>
            </>
          ) : (
            <div className="text-sm text-red-600 py-2">Impossible de charger les statistiques.</div>
          )}
        </div>

        {/* Scan action */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="font-semibold text-gray-900">Scanner les opportunités de swap</h2>
              <p className="text-sm text-gray-500 mt-1">Récupère tous les colis ZRExpress et détecte les matchs stricts (produit + couleur + taille).</p>
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
          <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-4 flex items-center gap-3 flex-wrap">
            <Filter size={16} className="text-gray-400" />
            <select
              value={filterConfidence}
              onChange={e => setFilterConfidence(e.target.value as 'ALL' | Confidence)}
              className="text-sm border border-stone-200 rounded-lg px-3 py-1.5"
            >
              <option value="ALL">Tous les matchs ({preview.stats.matches_count})</option>
              <option value="EXACT">Exact UUID ({preview.stats.by_confidence.EXACT})</option>
              <option value="STRONG">Couleur + taille confirmées ({preview.stats.by_confidence.STRONG})</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={onlySameCity} onChange={e => setOnlySameCity(e.target.checked)} />
              Même ville uniquement
            </label>
          </div>
        )}

        {/* Proposals table */}
        {preview && (
          preview.proposals.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-12 text-center">
              <Package size={36} className="mx-auto text-gray-300 mb-3" />
              <h3 className="font-semibold text-gray-900 mb-1">Aucun match trouvé</h3>
              <p className="text-sm text-gray-500">
                {preview.stats.total_swappable} colis swappable{preview.stats.total_swappable > 1 ? 's' : ''} ·
                {' '}{preview.stats.total_targets} commande{preview.stats.total_targets > 1 ? 's' : ''} en attente.
                <br />Aucune correspondance produit + couleur + taille détectée.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 border-b border-stone-100">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3">Colis à rediriger</th>
                      <th className="px-4 py-3">→ Nouveau client</th>
                      <th className="px-4 py-3">Produit · Variante</th>
                      <th className="px-4 py-3">Wilaya</th>
                      <th className="px-4 py-3 text-right">Économie</th>
                      <th className="px-4 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredProposals.map((p) => {
                      const key = proposalKey(p);
                      const meta = CONFIDENCE_META[p.confidence];
                      return (
                        <tr key={key} className="hover:bg-stone-50 align-top">
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs text-gray-900">{p.swappable.tracking}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{p.swappable.customer || '—'}</div>
                            <span className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${meta.bg} ${meta.text} ${meta.border}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{p.target.customer || '—'}</div>
                            <div className="text-xs text-gray-500">{p.target.customerPhone}</div>
                            <div className="font-mono text-[10px] text-gray-400 mt-0.5">{p.target.tracking}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-gray-900">{p.swappable.product}</div>
                            <div className="text-xs text-gray-500">
                              {p.swappable.variantColor && `${p.swappable.variantColor}`}
                              {p.swappable.variantSize && ` · T.${p.swappable.variantSize}`}
                              {p.swappable.quantity > 1 && ` · ${p.swappable.quantity}×`}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-gray-900 text-xs">
                              <MapPin size={11} className={p.same_city ? 'text-green-600' : 'text-gray-400'} />
                              {p.swappable.city}
                            </div>
                            {!p.same_city && (
                              <div className="text-[10px] text-gray-400 mt-0.5">→ {p.target.city}</div>
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
                <div className="text-center py-8 text-sm text-gray-500">
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

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: 'amber' | 'blue' | 'purple' | 'green' }) {
  const palette: Record<string, string> = {
    amber:  'bg-amber-50 text-amber-700',
    blue:   'bg-blue-50 text-blue-700',
    purple: 'bg-purple-50 text-purple-700',
    green:  'bg-green-50 text-green-700',
  };
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${palette[color]}`}>{icon}</div>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

function BreakdownItem({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-5 h-5 rounded flex items-center justify-center ${color}`}>{icon}</span>
      <span className="text-gray-500">{label} :</span>
      <span className="font-semibold text-gray-900">{value}</span>
    </div>
  );
}
