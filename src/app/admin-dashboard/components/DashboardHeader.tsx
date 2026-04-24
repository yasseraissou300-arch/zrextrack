'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, Download, Plus, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';

export default function DashboardHeader() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState('28/03/2026 à 22:58');
  const [connected, setConnected] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSync = () => {
    setSyncing(true);
    // TODO: Connect to ZREXpress API endpoint POST /api/sync/zrexpress
    setTimeout(() => {
      setSyncing(false);
      setLastSync('28/03/2026 à 23:07');
      toast?.success('Synchronisation ZREXpress réussie', {
        description: '47 commandes mises à jour',
      });
    }, 2200);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-100">
      <div>
        <div className="flex items-center gap-2.5 mb-0.5">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Tableau de bord
          </h1>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${
              connected
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
            {connected ? 'ZREXpress connecté' : 'Hors ligne'}
          </span>
        </div>
        <p className="text-xs text-gray-400">
          Dernière sync :{' '}
          <span suppressHydrationWarning className="font-medium text-gray-600">
            {mounted ? lastSync : '28/03/2026 à 22:58'}
          </span>
          {' · '}
          <button
            onClick={() => setConnected(!connected)}
            className="text-green-600 hover:underline"
          >
            Tester la connexion
          </button>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sync...' : 'Sync ZREXpress'}
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