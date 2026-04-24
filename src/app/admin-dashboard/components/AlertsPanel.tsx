'use client';

import React, { useState } from 'react';
import { AlertTriangle, X, ExternalLink, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

const alerts = [
  {
    id: 'alert-001',
    tracking: 'ZRX-204817',
    client: 'Nassim Boukhalfa',
    wilaya: 'Annaba (23)',
    message: 'Aucune mise à jour depuis 72h — livraison bloquée en hub',
    severity: 'critical',
    phone: '+213 555 123 456',
  },
  {
    id: 'alert-002',
    tracking: 'ZRX-198342',
    client: 'Fatima Zerrouki',
    wilaya: 'Constantine (25)',
    message: '3ème tentative de livraison échouée — client injoignable',
    severity: 'high',
    phone: '+213 661 987 654',
  },
  {
    id: 'alert-003',
    tracking: 'ZRX-211093',
    client: 'Yacine Hadj Amar',
    wilaya: 'Tizi Ouzou (15)',
    message: 'Adresse incorrecte signalée par le livreur',
    severity: 'medium',
    phone: '+213 770 345 678',
  },
];

const severityStyle: Record<string, { bar: string; bg: string; badge: string; label: string }> = {
  critical: {
    bar: 'bg-red-500',
    bg: 'bg-red-50 border-red-200',
    badge: 'bg-red-100 text-red-700',
    label: 'Critique',
  },
  high: {
    bar: 'bg-amber-500',
    bg: 'bg-amber-50 border-amber-200',
    badge: 'bg-amber-100 text-amber-700',
    label: 'Urgent',
  },
  medium: {
    bar: 'bg-yellow-400',
    bg: 'bg-yellow-50 border-yellow-200',
    badge: 'bg-yellow-100 text-yellow-700',
    label: 'Attention',
  },
};

export default function AlertsPanel() {
  const [dismissed, setDismissed] = useState<string[]>([]);

  const visible = alerts.filter((a) => !dismissed.includes(a.id));

  if (visible.length === 0) return null;

  const handleSendManual = (alert: (typeof alerts)[0]) => {
    // TODO: Connect to WhatsApp Business API POST /api/whatsapp/send
    toast.success(`Message envoyé à ${alert.client}`, {
      description: `+213 → ${alert.phone}`,
    });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-600" />
          <h2 className="text-sm font-600 text-[hsl(var(--foreground))]">Alertes actives</h2>
          <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {visible.length}
          </span>
        </div>
        <button
          onClick={() => setDismissed(alerts.map((a) => a.id))}
          className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          Tout ignorer
        </button>
      </div>
      <div className="divide-y divide-[hsl(var(--border))]">
        {visible.map((alert) => {
          const s = severityStyle[alert.severity];
          return (
            <div key={alert.id} className={`flex items-start gap-3 px-5 py-3.5 ${s.bg} border-l-0 relative animate-fade-in`}>
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar} rounded-none`} />
              <div className="flex-1 min-w-0 pl-1">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-[hsl(var(--foreground))]">{alert.tracking}</span>
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">·</span>
                  <span className="text-sm text-[hsl(var(--foreground))]">{alert.client}</span>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">{alert.wilaya}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.badge}`}>
                    {s.label}
                  </span>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{alert.message}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleSendManual(alert)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[hsl(var(--primary))] text-white text-xs font-medium hover:bg-green-700 transition-all duration-150 active:scale-95"
                >
                  <MessageSquare size={12} />
                  Contacter
                </button>
                <button className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-white hover:text-[hsl(var(--foreground))] transition-all duration-150">
                  <ExternalLink size={13} />
                </button>
                <button
                  onClick={() => setDismissed((d) => [...d, alert.id])}
                  className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-white hover:text-[hsl(var(--foreground))] transition-all duration-150"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}