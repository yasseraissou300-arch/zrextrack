'use client';

import React, { useEffect, useState } from 'react';
import { MessageSquare, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface Message {
  id: string;
  client: string;
  whatsapp: string;
  tracking: string;
  message: string;
  status: 'envoye' | 'echec' | 'en_attente';
  sent_at: string;
}

const statusConfig = {
  envoye: { label: 'Envoyé', icon: CheckCircle, color: 'text-green-500' },
  echec: { label: 'Échec', icon: XCircle, color: 'text-red-500' },
  en_attente: { label: 'En attente', icon: Clock, color: 'text-amber-500' },
};

export default function WhatsAppMessageLog() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => { fetchMessages(); }, []);

  const fetchMessages = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(20);
    setMessages(data || []);
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 h-full flex flex-col">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-green-500" />
          <h2 className="font-semibold text-gray-900">Messages WhatsApp</h2>
        </div>
        <button onClick={fetchMessages} className="p-1.5 hover:bg-gray-100 rounded-lg">
          <RefreshCw size={14} className="text-gray-400" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">Chargement...</div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400">
            <MessageSquare size={32} className="mb-2 opacity-30" />
            <p className="text-sm">Aucun message envoyé</p>
          </div>
        ) : messages.map(msg => {
          const cfg = statusConfig[msg.status] || statusConfig.en_attente;
          const Icon = cfg.icon;
          return (
            <div key={msg.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 text-sm">{msg.client}</span>
                    <span className="text-xs text-gray-400">{msg.whatsapp}</span>
                  </div>
                  {msg.tracking && <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">{msg.tracking}</span>}
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{msg.message}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Icon size={14} className={cfg.color} />
                  <span className="text-[10px] text-gray-400">
                    {new Date(msg.sent_at).toLocaleDateString('fr-FR')}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
