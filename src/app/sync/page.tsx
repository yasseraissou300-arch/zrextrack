'use client';

import AppLayout from '@/components/ui/AppLayout';
import { useEffect, useState } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, Key, Package,
  Clock, AlertTriangle, Eye, EyeOff
} from 'lucide-react';

const STORAGE_KEY = 'zrexpress_token';

interface SyncResult {
  synced?: number;
  total?: number;
  message?: string;
  error?: string;
}

interface SyncHistory {
  date: string;
  synced: number;
  total: number;
  status: 'success' | 'error';
  message: string;
}

export default function SyncPage() {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [history, setHistory] = useState<SyncHistory[]>([]);
  const [tokenSaved, setTokenSaved] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { setToken(saved); setTokenSaved(true); }
    const hist = localStorage.getItem('zrexpress_sync_history');
    if (hist) setHistory(JSON.parse(hist));
  }, []);

  const saveToken = () => {
    if (!token.trim()) return;
    localStorage.setItem(STORAGE_KEY, token.trim());
    setTokenSaved(true);
  };

  const clearToken = () => {
    localStorage.removeItem(STORAGE_KEY);
    setToken('');
    setTokenSaved(false);
  };

  const runSync = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/sync-zrexpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data: SyncResult = await res.json();
      setResult(data);
      const entry: SyncHistory = {
        date: new Date().toISOString(),
        synced: data.synced ?? 0,
        total: data.total ?? 0,
        status: data.error ? 'error' : 'success',
        message: data.error || data.message || '',
      };
      const newHistory = [entry, ...history].slice(0, 10);
      setHistory(newHistory);
      localStorage.setItem('zrexpress_sync_history', JSON.stringify(newHistory));
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <AppLayout>
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <RefreshCw size={20} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Sync ZREXpress</h1>
            <p className="text-sm text-gray-500">Importez vos commandes depuis ZREXpress automatiquement</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Key size={18} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Clé API ZREXpress</h2>
                {tokenSaved && (
                  <span className="ml-auto text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full">
                    ✓ Enregistrée
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Collez votre <strong>secretKey</strong> depuis{' '}
                <a href="https://app.zrexpress.app/api-rest/tokens" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  app.zrexpress.app → API Rest → Jetons API
                </a>
              </p>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="zZhWCuWz..."
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-12 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400"
                />
                <button onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={saveToken} disabled={!token.trim()} className="flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Enregistrer la clé
                </button>
                {tokenSaved && (
                  <button onClick={clearToken} className="text-sm text-red-500 hover:text-red-700 px-4 transition-colors">
                    Supprimer
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Package size={18} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Synchronisation</h2>
              </div>
              <p className="text-sm text-gray-500 mb-6">
                Cliquez sur le bouton ci-dessous pour importer toutes vos commandes ZREXpress dans ZREXtrack. Les commandes existantes seront mises à jour.
              </p>
              <button
                onClick={runSync}
                disabled={loading || !token.trim()}
                className="w-full flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-4 rounded-xl transition-colors text-base disabled:cursor-not-allowed"
              >
                <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Synchronisation en cours...' : 'Synchroniser maintenant'}
              </button>
              {result && (
                <div className={`mt-4 rounded-xl p-4 flex items-start gap-3 ${result.error ? 'bg-red-50 border border-red-100' : 'bg-green-50 border border-green-100'}`}>
                  {result.error ? (
                    <XCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    {result.error ? (
                      <>
                        <p className="font-medium text-red-700 text-sm">Erreur de synchronisation</p>
                        <p className="text-red-600 text-sm mt-0.5">{result.error}</p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-green-700 text-sm">Synchronisation réussie !</p>
                        <p className="text-green-600 text-sm mt-0.5">{result.synced} commandes importées sur {result.total} trouvées</p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Comment ça marche</h2>
              <div className="space-y-3">
                {[
                  { step: '1', text: 'Entrez votre clé API ZREXpress' },
                  { step: '2', text: 'Cliquez sur "Synchroniser"' },
                  { step: '3', text: 'Toutes vos commandes sont importées' },
                  { step: '4', text: 'Les statuts sont mis à jour automatiquement' },
                ].map(s => (
                  <div key={s.step} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{s.step}</span>
                    <span className="text-sm text-gray-600">{s.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Historique</h2>
              </div>
              {history.length === 0 ? (
                <div className="text-center py-6">
                  <Clock size={28} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-sm text-gray-400">Aucune sync effectuée</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs py-2 border-b border-gray-50 last:border-0">
                      {h.status === 'success' ? (
                        <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-700 font-medium truncate">{h.status === 'success' ? `${h.synced} commandes` : 'Erreur'}</p>
                        <p className="text-gray-400">{formatDate(h.date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
      }
