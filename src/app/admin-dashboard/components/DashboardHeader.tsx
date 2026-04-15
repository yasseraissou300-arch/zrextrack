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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))] tracking-tight">
            Tableau de bord
          </h1>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
              connected
                ? 'bg-green-50 text-green-700 border border-green-200' :'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
            {connected ? 'ZREXpress connecté' : 'Hors ligne'}
          </span>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Dernière sync :{' '}
          <span suppressHydrationWarning className="font-medium text-[hsl(var(--foreground))]">
            {mounted ? lastSync : '28/03/2026 à 22:58'}
          </span>
          {' · '}
          <button
            onClick={() => setConnected(!connected)}
            className="text-[hsl(var(--primary))] hover:underline text-xs"
          >
            Tester la connexion
          </button>
        </p>
      </div>

      <div className="flex items-center gap-2.5">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[hsl(var(--border))] bg-white text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] transition-all duration-150 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Synchronisation...' : 'Sync ZREXpress'}
        </button>
        <button className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[hsl(var(--border))] bg-white text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] transition-all duration-150 active:scale-95">
          <Download size={15} />
          Exporter
        </button>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--primary))] text-white text-sm font-medium hover:bg-green-700 transition-all duration-150 active:scale-95 shadow-sm">
          <Plus size={15} />
          Nouvelle commande
        </button>
      </div>
    </div>
  );
}