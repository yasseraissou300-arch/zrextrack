'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, X, RefreshCw } from 'lucide-react';
import { SYNC_DONE_EVENT } from './DashboardHeader';

interface StuckOrder {
  id: string;
  tracking: string;
  client: string;
  wilaya: string;
  status: string;
  last_update: string;
  hours: number;
}

const STATUS_LABEL: Record<string, string> = {
  en_preparation: 'En préparation',
  en_transit: 'En transit',
  en_livraison: 'En livraison',
};

const THRESHOLDS: Record<string, number> = {
  en_preparation: 48,
  en_transit: 72,
  en_livraison: 48,
};

export default function AlertsPanel() {
  const [orders, setOrders] = useState<StuckOrder[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStuck = useCallback(async () => {
    try {
      const res = await fetch('/api/kpis/stuck');
      if (!res.ok) return;
      const json = await res.json();
      setOrders(json.data || []);
    } catch {
      // silencieux
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStuck();
    const interval = setInterval(fetchStuck, 60_000);
    return () => clearInterval(interval);
  }, [fetchStuck]);

  useEffect(() => {
    const handler = () => fetchStuck();
    window.addEventListener(SYNC_DONE_EVENT, handler);
    return () => window.removeEventListener(SYNC_DONE_EVENT, handler);
  }, [fetchStuck]);

  const visible = orders.filter(o => !dismissed.includes(o.id));

  if (loading) return null;
  if (visible.length === 0) return null;

  const getSeverity = (hours: number, status: string) => {
    const threshold = THRESHOLDS[status] ?? 48;
    if (hours > threshold * 2) return { bar: 'bg-red-500', bg: 'bg-red-50', badge: 'bg-red-100 text-red-700', label: 'Critique' };
    if (hours > threshold) return { bar: 'bg-amber-500', bg: 'bg-amber-50', badge: 'bg-amber-100 text-amber-700', label: 'Retard' };
    return { bar: 'bg-yellow-400', bg: 'bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700', label: 'Attention' };
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-800">Commandes bloquées</h2>
          <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {visible.length}
          </span>
        </div>
        <button
          onClick={() => setDismissed(orders.map(o => o.id))}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Tout ignorer
        </button>
      </div>
      <div className="divide-y divide-gray-50">
        {visible.map((order) => {
          const s = getSeverity(order.hours, order.status);
          return (
            <div key={order.id} className={`flex items-center gap-3 px-5 py-3 ${s.bg} relative`}>
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} />
              <div className="flex-1 min-w-0 pl-1">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-gray-800 font-mono">{order.tracking}</span>
                  <span className="text-sm text-gray-500">{order.client}</span>
                  {order.wilaya && <span className="text-xs text-gray-400">{order.wilaya}</span>}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.badge}`}>{s.label}</span>
                </div>
                <p className="text-xs text-gray-500">
                  {STATUS_LABEL[order.status] || order.status} · Sans mise à jour depuis <strong>{order.hours}h</strong>
                </p>
              </div>
              <button
                onClick={() => setDismissed(d => [...d, order.id])}
                className="p-1.5 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-white transition-all"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
