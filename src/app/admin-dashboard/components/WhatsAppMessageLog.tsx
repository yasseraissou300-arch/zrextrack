'use client';

import React, { useState } from 'react';
import { MessageSquare, CheckCheck, Clock, AlertCircle, ChevronDown } from 'lucide-react';

type MsgStatus = 'sent' | 'delivered' | 'read' | 'failed';

interface WaMessage {
  id: string;
  tracking: string;
  client: string;
  phone: string;
  type: string;
  status: MsgStatus;
  time: string;
  preview: string;
}

const messages: WaMessage[] = [
  { id: 'msg-001', tracking: 'ZRX-207561', client: 'Amina Bensalem', phone: '+213 550 678 901', type: 'Livraison réussie', status: 'read', time: 'il y a 8 min', preview: 'Votre commande a été livrée avec succès !' },
  { id: 'msg-002', tracking: 'ZRX-221067', client: 'Hocine Aissaoui', phone: '+213 553 567 234', type: 'En cours de livraison', status: 'delivered', time: 'il y a 22 min', preview: 'Votre colis est en route vers vous !' },
  { id: 'msg-003', tracking: 'ZRX-198342', client: 'Fatima Zerrouki', phone: '+213 661 987 654', type: 'Tentative échouée', status: 'sent', time: 'il y a 45 min', preview: 'Nous n\'avons pas pu livrer votre colis...' },
  { id: 'msg-004', tracking: 'ZRX-215782', client: 'Souad Khelifi', phone: '+213 771 456 789', type: 'Commande confirmée', status: 'read', time: 'il y a 1h', preview: 'Votre commande est enregistrée chez ZREXpress.' },
  { id: 'msg-005', tracking: 'ZRX-209834', client: 'Sofiane Belhadj', phone: '+213 699 789 345', type: 'En cours de livraison', status: 'delivered', time: 'il y a 1h 15min', preview: 'Votre colis est en route vers vous !' },
  { id: 'msg-006', tracking: 'ZRX-203498', client: 'Rachid Bouchenak', phone: '+213 699 234 567', type: 'Livraison réussie', status: 'failed', time: 'il y a 2h', preview: 'Votre commande a été livrée avec succès !' },
  { id: 'msg-007', tracking: 'ZRX-195678', client: 'Meriem Chentouf', phone: '+213 770 123 890', type: 'Commande confirmée', status: 'read', time: 'il y a 3h', preview: 'Votre commande est enregistrée chez ZREXpress.' },
  { id: 'msg-008', tracking: 'ZRX-218345', client: 'Lynda Meddour', phone: '+213 662 345 012', type: 'Commande confirmée', status: 'delivered', time: 'il y a 4h', preview: 'Votre commande est enregistrée chez ZREXpress.' },
];

const statusConfig: Record<MsgStatus, { icon: React.ReactNode; label: string; color: string }> = {
  read: { icon: <CheckCheck size={12} />, label: 'Lu', color: 'text-blue-500' },
  delivered: { icon: <CheckCheck size={12} />, label: 'Reçu', color: 'text-green-600' },
  sent: { icon: <Clock size={12} />, label: 'Envoyé', color: 'text-[hsl(var(--muted-foreground))]' },
  failed: { icon: <AlertCircle size={12} />, label: 'Échec', color: 'text-red-500' },
};

const typeColor: Record<string, string> = {
  'Livraison réussie': 'bg-green-100 text-green-700',
  'En cours de livraison': 'bg-amber-100 text-amber-700',
  'Commande confirmée': 'bg-blue-100 text-blue-700',
  'Tentative échouée': 'bg-red-100 text-red-700',
};

export default function WhatsAppMessageLog() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const stats = {
    total: messages.length,
    read: messages.filter((m) => m.status === 'read').length,
    failed: messages.filter((m) => m.status === 'failed').length,
  };

  return (
    <div className="bg-white rounded-xl border border-[hsl(var(--border))] overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-green-100 rounded-lg flex items-center justify-center">
              <MessageSquare size={14} className="text-green-700" />
            </div>
            <h2 className="text-[15px] font-600 text-[hsl(var(--foreground))]">Messages WhatsApp</h2>
          </div>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
            Aujourd'hui
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Envoyés', value: stats.total, color: 'text-[hsl(var(--foreground))]' },
            { label: 'Lus', value: stats.read, color: 'text-blue-600' },
            { label: 'Échecs', value: stats.failed, color: 'text-red-500' },
          ].map((stat) => (
            <div key={`stat-${stat.label}`} className="bg-[hsl(var(--secondary))] rounded-lg px-3 py-2 text-center">
              <p className={`text-lg font-bold tabular-nums ${stat.color}`}>{stat.value}</p>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-medium">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-[hsl(var(--border))]">
        {messages.map((msg) => {
          const sc = statusConfig[msg.status];
          const isExpanded = expanded === msg.id;
          return (
            <div key={msg.id} className="hover:bg-[hsl(var(--secondary))]/40 transition-colors duration-100">
              <button
                className="w-full text-left px-4 py-3"
                onClick={() => setExpanded(isExpanded ? null : msg.id)}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-[hsl(var(--foreground))] truncate">{msg.client}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`flex items-center gap-0.5 text-[10px] font-medium ${sc.color}`}>
                      {sc.icon}
                      {sc.label}
                    </span>
                    <ChevronDown
                      size={12}
                      className={`text-[hsl(var(--muted-foreground))] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${typeColor[msg.type] ?? 'bg-gray-100 text-gray-600'}`}>
                    {msg.type}
                  </span>
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] tabular-nums font-medium">
                    {msg.tracking}
                  </span>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{msg.preview}</p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">{msg.time}</p>
              </button>
              {isExpanded && (
                <div className="px-4 pb-3 animate-fade-in">
                  <div className="bg-green-50 border border-green-100 rounded-lg p-3">
                    <p className="text-xs text-green-900 leading-relaxed whitespace-pre-wrap">{msg.preview}</p>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-green-100">
                      <span className="text-[10px] text-green-700 font-medium">{msg.phone}</span>
                      <span className={`flex items-center gap-1 text-[10px] font-medium ${sc.color}`}>
                        {sc.icon}
                        {sc.label}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/30">
        <button className="w-full text-xs font-medium text-[hsl(var(--primary))] hover:text-green-700 transition-colors text-center">
          Voir tout l'historique →
        </button>
      </div>
    </div>
  );
}