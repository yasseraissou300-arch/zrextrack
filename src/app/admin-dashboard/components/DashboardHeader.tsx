'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Download, Plus, Wifi, WifiOff, Zap, PauseCircle, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';

const STORAGE_KEY = 'zrexpress_token';
const TENANT_KEY = 'zrexpress_tenant';
const TEMPLATES_KEY = 'zrextrack_templates';
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
        body: JSON.stringify({ token, tenantId, templates: JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '{}') }),
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

  return (
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
        <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500 text-white text-sm font-semibold hover:bg-green-600 transition-all active:scale-95 shadow-sm">
          <Plus size={14} />
          Nouvelle commande
        </button>
      </div>
    </div>
  );
}
