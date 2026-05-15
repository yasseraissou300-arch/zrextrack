'use client';

import AppLayout from '@/components/ui/AppLayout';
import { useEffect, useMemo, useState } from 'react';
import {
  Repeat, Search, CheckCircle2, XCircle, AlertTriangle,
  MapPin, TrendingUp, Package, Filter, PlayCircle, Loader2,
} from 'lucide-react';
import type { MatchProposal, PreviewResponse, ExecuteResponse, Confidence } from '@/lib/autoswap/types';

const STORAGE_KEY = 'zrexpress_token';
const TENANT_KEY = 'zrexpress_tenant';

const CONFIDENCE_META: Record<Confidence, { label: string; bg: string; text: string; border: string }> = {
  EXACT:  { label: 'Exact',  bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  STRONG: { label: 'Fort',   bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  WEAK:   { label: 'Faible — à vérifier', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
};

export default function AutoSwapPage() {
  const [token, setToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [credentialsReady, setCredentialsReady] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterConfidence, setFilterConfidence] = useState<'ALL' | Confidence>('ALL');
  const [onlySameCity, setOnlySameCity] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(STORAGE_KEY) || '';
    const ti = localStorage.getItem(TENANT_KEY) || '';
    setToken(t);
    setTenantId(ti);
    setCredentialsReady(!!t && !!ti);
  }, []);

  const runScan = async () => {
    if (!credentialsReady) return;
    setScanning(true);
    setError(null);
    setExecuteResult(null);
    setSelected(new Set());
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

  const toggleSelect = (p: MatchProposal) => {
    setSelected(prev => {
      const next = new Set(prev);
      const key = proposalKey(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected(new Set(filteredProposals.map(proposalKey)));
  };

  const deselectAll = () => setSelected(new Set());

  const totalSelectedSavings = useMemo(() => {
    if (!preview) return 0;
    return preview.proposals
      .filter(p => selected.has(proposalKey(p)))
      .reduce((sum, p) => sum + p.estimated_savings, 0);
  }, [preview, selected]);

  const runExecute = async () => {
    if (!preview || selected.size === 0) return;
    const confirmMsg = `Confirmer l'exécution de ${selected.size} swap${selected.size > 1 ? 's' : ''} ?\n\n` +
                      `Cette action est irréversible et appelle l'API ZRExpress.`;
    if (!window.confirm(confirmMsg)) return;

    const approved_swaps = preview.proposals.filter(p => selected.has(proposalKey(p)));
    setExecuting(true);
    setError(null);
    try {
      const res = await fetch('/api/autoswap/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, tenantId, approved_swaps }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setExecuteResult(data as ExecuteResponse);
      // Retire les swaps réussis de la liste pour éviter les re-exécutions.
      const successTrackings = new Set(
        (data as ExecuteResponse).results.filter(r => r.status === 'success').map(r => r.source_tracking),
      );
      setPreview(prev => prev ? {
        ...prev,
        proposals: prev.proposals.filter(p => !successTrackings.has(p.swappable.tracking)),
      } : prev);
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
            <Repeat size={20} className="text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">AutoSwap</h1>
            <p className="text-sm text-gray-500">Réaffectez les colis annulés à de nouveaux clients confirmés — avant qu'ils ne reviennent à l'entrepôt</p>
          </div>
        </div>

        {/* Credentials check */}
        {!credentialsReady && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <AlertTriangle className="inline-block mr-2" size={16} />
            Aucune clé API ZRExpress trouvée. Configurez-la d'abord sur la page <a href="/sync" className="underline font-medium">Sync</a>.
          </div>
        )}

        {/* Action bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="font-semibold text-gray-900">Scanner les opportunités de swap</h2>
              <p className="text-sm text-gray-500 mt-1">Récupère tous les colis ZRExpress et détecte les matchs entre colis annulés et nouvelles commandes.</p>
            </div>
            <button
              onClick={runScan}
              disabled={scanning || !credentialsReady}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              {scanning ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              {scanning ? 'Analyse en cours…' : 'Scanner pour swaps'}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-start gap-2">
            <XCircle size={18} className="shrink-0 mt-0.5" />
            <div><strong>Erreur :</strong> {error}</div>
          </div>
        )}

        {/* Execute result */}
        {executeResult && (
          <div className={`rounded-xl p-4 text-sm flex items-start gap-2 ${
            executeResult.failed === 0 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-amber-50 border border-amber-200 text-amber-800'
          }`}>
            <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
            <div>
              <strong>{executeResult.executed} swap{executeResult.executed > 1 ? 's' : ''} exécuté{executeResult.executed > 1 ? 's' : ''}</strong>
              {executeResult.failed > 0 && <span> · {executeResult.failed} échec{executeResult.failed > 1 ? 's' : ''}</span>}
              {executeResult.failed > 0 && (
                <ul className="mt-2 text-xs space-y-1">
                  {executeResult.results.filter(r => r.status === 'failed').map((r, i) => (
                    <li key={i}>• {r.source_tracking} → {r.target_tracking} : {r.error}</li>
                  ))}
                </ul>
              )}
            </div>
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

        {/* Filters + Bulk actions */}
        {preview && preview.proposals.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Filter size={16} className="text-gray-400" />
                <select
                  value={filterConfidence}
                  onChange={e => setFilterConfidence(e.target.value as 'ALL' | Confidence)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
                >
                  <option value="ALL">Tous les matchs ({preview.stats.matches_count})</option>
                  <option value="EXACT">Exact UUID ({preview.stats.by_confidence.EXACT})</option>
                  <option value="STRONG">Couleur + taille confirmées ({preview.stats.by_confidence.STRONG})</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={onlySameCity} onChange={e => setOnlySameCity(e.target.checked)} />
                  Même ville uniquement
                </label>
                <button onClick={selectAllFiltered} className="text-sm text-purple-600 hover:underline">Tout sélectionner</button>
                <button onClick={deselectAll} className="text-sm text-gray-500 hover:underline">Désélectionner</button>
              </div>
              <button
                onClick={runExecute}
                disabled={executing || selected.size === 0}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
              >
                {executing ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
                Exécuter {selected.size} swap{selected.size > 1 ? 's' : ''} ({totalSelectedSavings.toFixed(0)} DA)
              </button>
            </div>
          </div>
        )}

        {/* Proposals table */}
        {preview && (
          preview.proposals.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
              <Package size={36} className="mx-auto text-gray-300 mb-3" />
              <h3 className="font-semibold text-gray-900 mb-1">Aucun match trouvé</h3>
              <p className="text-sm text-gray-500">
                {preview.stats.total_swappable} colis swappable{preview.stats.total_swappable > 1 ? 's' : ''} ·
                {' '}{preview.stats.total_targets} commande{preview.stats.total_targets > 1 ? 's' : ''} en attente d'expédition.
                <br />Aucune correspondance de produit/variante détectée entre les deux listes.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 w-10"></th>
                      <th className="px-4 py-3">Confiance</th>
                      <th className="px-4 py-3">Colis annulé</th>
                      <th className="px-4 py-3">→ Nouveau client</th>
                      <th className="px-4 py-3">Produit</th>
                      <th className="px-4 py-3">Wilaya</th>
                      <th className="px-4 py-3 text-right">Économie</th>
                      <th className="px-4 py-3 text-center">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredProposals.map((p) => {
                      const key = proposalKey(p);
                      const isSelected = selected.has(key);
                      const meta = CONFIDENCE_META[p.confidence];
                      return (
                        <tr key={key} className={isSelected ? 'bg-purple-50/30' : 'hover:bg-gray-50'}>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(p)}
                              className="w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full border ${meta.bg} ${meta.text} ${meta.border}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{p.swappable.tracking}</div>
                            <div className="text-xs text-gray-500">{p.swappable.customer || '—'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{p.target.customer || '—'}</div>
                            <div className="text-xs text-gray-500">{p.target.tracking}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-gray-900">{p.swappable.product}</div>
                            <div className="text-xs text-gray-500">
                              {p.swappable.variantColor && `${p.swappable.variantColor} · `}
                              {p.swappable.variantSize && `T. ${p.swappable.variantSize}`}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-gray-900">
                              <MapPin size={12} className={p.same_city ? 'text-green-600' : 'text-gray-400'} />
                              {p.swappable.city}
                              {p.same_city ? (
                                <span className="ml-1 text-xs text-green-700">✓ même ville</span>
                              ) : p.same_wilaya ? (
                                <span className="ml-1 text-xs text-blue-700">même wilaya</span>
                              ) : (
                                <span className="ml-1 text-xs text-gray-500">→ {p.target.city}</span>
                              )}
                            </div>
                            {p.warnings.length > 0 && (
                              <div className="text-xs text-amber-700 mt-1">⚠️ {p.warnings[0]}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-green-700">
                            +{p.estimated_savings.toFixed(0)} DA
                          </td>
                          <td className="px-4 py-3 text-center text-gray-500">{p.score}</td>
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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${palette[color]}`}>{icon}</div>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}
