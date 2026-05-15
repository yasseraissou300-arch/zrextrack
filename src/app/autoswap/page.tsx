'use client';

import AppLayout from '@/components/ui/AppLayout';
import { useEffect, useMemo, useState } from 'react';
import {
  Repeat, Search, CheckCircle2, AlertTriangle, MapPin, TrendingUp,
  Package, Filter, Loader2, ExternalLink, Copy, Check, Info,
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

function formatSwapInfo(p: MatchProposal): string {
  const addr = p.target.swapPayload.deliveryAddress;
  const phones = p.target.swapPayload.phone;
  const phoneList = [phones.number1, phones.number2, phones.number3].filter(Boolean).join(' / ');
  return [
    `=== SWAP : ${p.swappable.tracking} → ${p.target.customer} ===`,
    ``,
    `📦 Colis à rediriger : ${p.swappable.tracking}`,
    `📋 Produit : ${p.swappable.product} · ${p.swappable.variantColor || ''} · ${p.swappable.variantSize ? 'T.' + p.swappable.variantSize : ''}`,
    ``,
    `👤 Nouveau client : ${p.target.customer}`,
    `📱 Téléphone : ${phoneList}`,
    `📍 Adresse : ${addr.street || ''}, ${addr.district || ''}, ${addr.city || ''}`,
    `🚚 Type livraison : ${p.target.swapPayload.deliveryType || 'home'}`,
    `💵 Montant COD : ${p.target.amount.toFixed(0)} DA`,
    ``,
    `💰 Économie estimée : ${p.estimated_savings.toFixed(0)} DA`,
  ].join('\n');
}

export default function AutoSwapPage() {
  const [token, setToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [credentialsReady, setCredentialsReady] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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

  const copyToClipboard = async (p: MatchProposal) => {
    const text = formatSwapInfo(p);
    try {
      await navigator.clipboard.writeText(text);
      const key = proposalKey(p);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 2000);
    } catch {
      setError('Impossible de copier dans le presse-papier');
    }
  };

  const openInZRExpress = (p: MatchProposal) => {
    copyToClipboard(p);
    // Lien direct vers la fiche du colis swappable — pas la liste générale.
    window.open(parcelDetailUrl(p.swappable.id), '_blank', 'noopener,noreferrer');
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
            <p className="text-sm text-gray-500">Détecte les swaps possibles et facilite l'exécution dans ZRExpress</p>
          </div>
        </div>

        {/* Info banner — workflow explanation */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <strong>Mode copilote :</strong> ZRExpress n'autorise pas encore l'exécution des swaps via API externe.
            AutoTim trouve automatiquement les matchs (produit + couleur + taille identiques), puis pour chaque swap tu cliques
            <strong> « Ouvrir dans ZRExpress »</strong> — AutoTim copie automatiquement les infos du nouveau client dans ton presse-papier
            et ouvre la page Swap. Tu colles, tu confirmes, c'est fait.
          </div>
        </div>

        {/* Credentials check */}
        {!credentialsReady && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <AlertTriangle className="inline-block mr-2" size={16} />
            Aucune clé API ZRExpress trouvée. Configurez-la d'abord sur la page <a href="/sync" className="underline font-medium">Sync</a>.
          </div>
        )}

        {/* Scan action */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="font-semibold text-gray-900">Scanner les opportunités de swap</h2>
              <p className="text-sm text-gray-500 mt-1">Récupère tous les colis ZRExpress et détecte les matchs stricts (produit + couleur + taille).</p>
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
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3 flex-wrap">
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
                {' '}{preview.stats.total_targets} commande{preview.stats.total_targets > 1 ? 's' : ''} en attente.
                <br />Aucune correspondance produit + couleur + taille détectée.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3">Colis à rediriger</th>
                      <th className="px-4 py-3">→ Nouveau client</th>
                      <th className="px-4 py-3">Produit · Variante</th>
                      <th className="px-4 py-3">Wilaya</th>
                      <th className="px-4 py-3 text-right">Économie</th>
                      <th className="px-4 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredProposals.map((p) => {
                      const key = proposalKey(p);
                      const wasCopied = copiedKey === key;
                      const meta = CONFIDENCE_META[p.confidence];
                      return (
                        <tr key={key} className="hover:bg-gray-50 align-top">
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
                            <div className="flex flex-col gap-1 items-stretch min-w-[160px]">
                              <button
                                onClick={() => openInZRExpress(p)}
                                className="flex items-center justify-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white font-medium px-3 py-1.5 rounded-md transition-colors"
                                title="Copie les infos et ouvre la page Swap de ZRExpress"
                              >
                                <ExternalLink size={12} />
                                Ouvrir dans ZRExpress
                              </button>
                              <button
                                onClick={() => copyToClipboard(p)}
                                className={`flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                                  wasCopied
                                    ? 'bg-green-50 text-green-700 border border-green-200'
                                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200'
                                }`}
                                title="Copie les infos du nouveau client dans le presse-papier"
                              >
                                {wasCopied ? <Check size={12} /> : <Copy size={12} />}
                                {wasCopied ? 'Copié ✓' : 'Copier infos'}
                              </button>
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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${palette[color]}`}>{icon}</div>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}
