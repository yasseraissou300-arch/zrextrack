'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Download, Plus, Wifi, WifiOff, Zap, PauseCircle, PlayCircle, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const STORAGE_KEY = 'zrexpress_token';
const TENANT_KEY = 'zrexpress_tenant';
const TEMPLATES_KEY = 'zrextrack_templates';
const NOTIFY_ENABLED_KEY = 'zrextrack_notify_enabled';
const AUTO_SYNC_INTERVAL = 30_000; // 30 secondes

// Event pour notifier les autres composants qu'un sync vient de se faire
export const SYNC_DONE_EVENT = 'zrextrack:sync-done';

export default function DashboardHeader() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY);
    const tenant = localStorage.getItem(TENANT_KEY);
    setHasToken(!!token && !!tenant);

    // Charger la dernière date de sync
    const lastSyncStored = localStorage.getItem('zrextrack_last_sync');
    if (lastSyncStored) setLastSync(lastSyncStored);

    // Activer l'auto-sync si le token existe (sauf si l'utilisateur l'a désactivé manuellement)
    const autoDisabled = localStorage.getItem('zrextrack_autosync_disabled') === 'true';
    if (token && tenant && !autoDisabled) {
      setAutoSyncEnabled(true);
    }
  }, []);

  const toggleAutoSync = () => {
    const next = !autoSyncEnabled;
    setAutoSyncEnabled(next);
    localStorage.setItem('zrextrack_autosync_disabled', next ? 'false' : 'true');
    if (next) {
      toast.success('Auto-sync activé', { description: 'Synchronisation automatique toutes les 30 secondes.' });
    } else {
      toast.info('Auto-sync arrêté', { description: 'Cliquez sur "Sync maintenant" pour synchroniser manuellement.' });
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  };

  const runSync = useCallback(async (silent = false) => {
    const token = localStorage.getItem(STORAGE_KEY);
    const tenantId = localStorage.getItem(TENANT_KEY);
    if (!token || !tenantId) {
      if (!silent) toast.error('Token ZREXpress non configuré', { description: 'Allez dans Sync ZREXpress pour configurer votre clé API.' });
      return;
    }

    setSyncing(true);
    try {
      const res = await fetch('/api/sync-zrexpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          tenantId,
          templates: JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '{}'),
          notifyEnabled: JSON.parse(localStorage.getItem(NOTIFY_ENABLED_KEY) || '{}'),
        }),
      });
      const json = await res.json();

      if (!res.ok || json.error) {
        if (!silent) toast.error('Erreur de synchronisation', { description: json.error });
      } else {
        const now = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastSync(now);
        setSyncedCount(json.synced ?? 0);
        localStorage.setItem('zrextrack_last_sync', now);

        // Notifier les autres composants (KPIs, table)
        window.dispatchEvent(new Event(SYNC_DONE_EVENT));

        if (!silent) {
          toast.success(`Sync réussie — ${json.synced ?? 0} commandes`, { description: json.message });
        }
      }
    } catch (err: any) {
      if (!silent) toast.error('Erreur réseau', { description: err.message });
    } finally {
      setSyncing(false);
    }
  }, []);

  // Auto-sync toutes les 30 secondes si le token est présent
  useEffect(() => {
    if (!autoSyncEnabled) return;

    // Premier sync immédiat au chargement
    runSync(true);

    intervalRef.current = setInterval(() => runSync(true), AUTO_SYNC_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoSyncEnabled, runSync]);

  const handleClearAll = async () => {
    setClearing(true);
    try {
      const res = await fetch('/api/orders/clear-all', { method: 'DELETE' });
      const json = await res.json();
      if (json.error) {
        toast.error(json.error);
      } else {
        toast.success(`${json.deleted} commande(s) supprimée(s)`);
        setShowClearModal(false);
        window.dispatchEvent(new Event(SYNC_DONE_EVENT));
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
    {showClearModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Vider l'historique</h3>
              <p className="text-xs text-gray-500">Cette action est irréversible</p>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Toutes vos commandes seront définitivement supprimées. Cette action ne peut pas être annulée.
          </p>
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => setShowClearModal(false)}
              disabled={clearing}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              onClick={handleClearAll}
              disabled={clearing}
              className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {clearing ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {clearing ? 'Suppression...' : 'Tout supprimer'}
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-100">
      <div>
        <div className="flex items-center gap-2.5 mb-0.5">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Tableau de bord
          </h1>
          {hasToken ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">
              <Wifi size={10} />
              ZREXpress connecté
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
              <WifiOff size={10} />
              Token non configuré
            </span>
          )}
          {hasToken && (
            <button
              onClick={toggleAutoSync}
              title={autoSyncEnabled ? 'Arrêter l\'auto-sync' : 'Activer l\'auto-sync'}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border transition-all ${
                autoSyncEnabled
                  ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                  : 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200'
              }`}
            >
              {autoSyncEnabled
                ? <><Zap size={9} className="animate-pulse" />Auto-sync 30s<PauseCircle size={10} /></>
                : <><PlayCircle size={10} />Auto-sync OFF</>
              }
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400">
          {lastSync ? (
            <>
              Dernière sync : <span className="font-medium text-gray-600">{lastSync}</span>
              {syncedCount !== null && <span className="text-gray-400"> · {syncedCount} commandes</span>}
            </>
          ) : (
            <span className="text-gray-400">{hasToken ? 'Synchronisation en cours...' : 'Configurez votre token dans Sync ZREXpress'}</span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => runSync(false)}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin text-green-500' : ''} />
          {syncing ? 'Sync...' : 'Sync maintenant'}
        </button>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all active:scale-95 shadow-sm">
          <Download size={14} />
          Exporter
        </button>
        <button
          onClick={() => setShowClearModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-sm font-medium text-red-600 hover:bg-red-100 transition-all active:scale-95 shadow-sm"
        >
          <Trash2 size={14} />
          Vider l'historique
        </button>
        <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500 text-white text-sm font-semibold hover:bg-green-600 transition-all active:scale-95 shadow-sm">
          <Plus size={14} />
          Nouvelle commande
        </button>
      </div>
    </div>
    </>
  );
}
