'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw,
  Download,
  Plus,
  Wifi,
  WifiOff,
  Zap,
  PauseCircle,
  PlayCircle,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { loadSyncSettings } from '@/lib/sync-settings-client';

const AUTO_SYNC_INTERVAL = 300_000; // 5 minutes (léger + draine la file de notifs en douceur)

// Event pour notifier les autres composants qu'un sync vient de se faire
export const SYNC_DONE_EVENT = 'zrextrack:sync-done';

export default function DashboardHeader() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  // Phase 1 — d'où part réellement la synchronisation.
  // 'client' = ce navigateur seul (état initial de tous les tenants)
  // 'both'   = transition ; l'idempotence empêche le doublon
  // 'server' = cron ; le setInterval reste néanmoins actif en filet
  const [syncSource, setSyncSource] = useState<'client' | 'both' | 'server'>('client');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    // Charge depuis Supabase (cross-device). Le helper hydrate aussi le miroir
    // localStorage pour les pages qui ne sont pas encore migrées.
    loadSyncSettings().then((s) => {
      setHasToken(!!s.zrexpress_token && !!s.zrexpress_tenant_id);

      // Active l'auto-sync si token présent (sauf désactivation manuelle locale)
      const autoDisabled = localStorage.getItem('zrextrack_autosync_disabled') === 'true';
      const enabled = !!(s.zrexpress_token && s.zrexpress_tenant_id && !autoDisabled);
      if (enabled) setAutoSyncEnabled(true);

      // Phase 1 — remonte l'intention vers le serveur.
      // Jusqu'ici, « l'auto-sync est-il activé ? » n'existait QUE dans le
      // localStorage de ce navigateur : le serveur ne pouvait pas savoir quels
      // tenants synchroniser. On pousse donc l'état, puis on lit la source
      // réellement en vigueur (client / both / server).
      fetch('/api/sync/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_sync_enabled: enabled }),
      })
        .then(() => fetch('/api/sync/preferences'))
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          if (p?.sync_source) setSyncSource(p.sync_source);
        })
        .catch(() => {
          /* préférences serveur indisponibles : le navigateur reste maître */
        });
    });

    // Dernière date de sync : reste local (info per-appareil, pas critique)
    const lastSyncStored = localStorage.getItem('zrextrack_last_sync');
    if (lastSyncStored) setLastSync(lastSyncStored);
  }, []);

  const toggleAutoSync = () => {
    const next = !autoSyncEnabled;
    setAutoSyncEnabled(next);
    localStorage.setItem('zrextrack_autosync_disabled', next ? 'false' : 'true');

    // Propage au serveur — sans quoi le cron ne saurait pas que ce tenant
    // souhaite (ou ne souhaite plus) être synchronisé.
    fetch('/api/sync/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_sync_enabled: next }),
    }).catch(() => {
      /* non bloquant */
    });

    if (next) {
      toast.success('Auto-sync activé', {
        description:
          syncSource === 'client'
            ? 'Synchronisation toutes les 5 minutes tant que cet onglet reste ouvert.'
            : 'Synchronisation côté serveur — elle continue même onglet fermé.',
      });
    } else {
      toast.info('Auto-sync arrêté', {
        description: 'Cliquez sur "Sync maintenant" pour synchroniser manuellement.',
      });
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  };

  const runSync = useCallback(async (silent = false) => {
    const s = await loadSyncSettings();
    const token = s.zrexpress_token;
    const tenantId = s.zrexpress_tenant_id;
    if (!token || !tenantId) {
      if (!silent)
        toast.error('Token ZREXpress non configuré', {
          description: 'Allez dans Sync ZREXpress pour configurer votre clé API.',
        });
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
          templates: s.templates ?? {},
          notifyEnabled: s.notify_enabled ?? {},
        }),
      });
      const json = await res.json();

      if (!res.ok || json.error) {
        if (!silent) toast.error('Erreur de synchronisation', { description: json.error });
      } else {
        const now = new Date().toLocaleString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setLastSync(now);
        setSyncedCount(json.synced ?? 0);
        localStorage.setItem('zrextrack_last_sync', now);

        // Notifier les autres composants (KPIs, table)
        window.dispatchEvent(new Event(SYNC_DONE_EVENT));

        if (!silent) {
          toast.success(`Sync réussie — ${json.synced ?? 0} commandes`, {
            description: json.message,
          });
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
          <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-red-100 dark:bg-red-500/15 rounded-xl flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-stone-900 dark:text-stone-100">Vider l'historique</h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Cette action est irréversible
                </p>
              </div>
            </div>
            <p className="text-sm text-stone-600 dark:text-stone-300">
              Toutes vos commandes seront définitivement supprimées. Cette action ne peut pas être
              annulée.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowClearModal(false)}
                disabled={clearing}
                className="flex-1 py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-50 transition-colors disabled:opacity-50"
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100 dark:border-stone-800">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
            <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 tracking-tight">
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
                title={autoSyncEnabled ? "Arrêter l'auto-sync" : "Activer l'auto-sync"}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border transition-all ${
                  autoSyncEnabled
                    ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                    : 'bg-stone-100 text-stone-400 dark:text-stone-500 border-stone-200 hover:bg-stone-200'
                }`}
              >
                {autoSyncEnabled ? (
                  <>
                    <Zap size={9} className="animate-pulse" />
                    Auto-sync 30s
                    <PauseCircle size={10} />
                  </>
                ) : (
                  <>
                    <PlayCircle size={10} />
                    Auto-sync OFF
                  </>
                )}
              </button>
            )}
          </div>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            {lastSync ? (
              <>
                Dernière sync :{' '}
                <span className="font-medium text-stone-700 dark:text-stone-200">{lastSync}</span>
                {syncedCount !== null && (
                  <span className="text-stone-400 dark:text-stone-500">
                    {' '}
                    · {syncedCount} commandes
                  </span>
                )}
              </>
            ) : (
              <span className="text-stone-500 dark:text-stone-400">
                {hasToken
                  ? 'Synchronisation en cours...'
                  : 'Configurez votre token dans Sync ZREXpress'}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => runSync(false)}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 bg-white dark:bg-stone-900 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin text-violet-500' : ''} />
            {syncing ? 'Sync...' : 'Sync maintenant'}
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-all active:scale-95 shadow-sm">
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
          <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-sm font-semibold hover:shadow-lg hover:shadow-violet-500/30 transition-all active:scale-95 shadow-md shadow-violet-500/20">
            <Plus size={14} />
            Nouvelle commande
          </button>
        </div>
      </div>
    </>
  );
}
