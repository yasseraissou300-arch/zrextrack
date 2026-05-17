'use client';

import React, { useEffect, useState } from 'react';
import { MessageSquare, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface Message {
  id: string;
  customer_name: string;
  customer_whatsapp: string;
  tracking_number: string;
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
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800 h-full flex flex-col">
      <div className="p-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-green-500" />
          <h2 className="font-semibold text-gray-900 dark:text-stone-100">Messages WhatsApp</h2>
        </div>
        <button onClick={fetchMessages} className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg">
          <RefreshCw size={14} className="text-gray-400 dark:text-stone-500" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-stone-50 dark:divide-stone-800">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400 dark:text-stone-500">Chargement...</div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
            <div className="relative mb-3">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-200 to-fuchsia-200 dark:from-violet-500/20 dark:to-fuchsia-500/20 blur-xl rounded-full" />
              <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100 dark:from-violet-500/15 dark:to-fuchsia-500/15 flex items-center justify-center">
                <MessageSquare size={20} className="text-violet-500 dark:text-violet-300" />
              </div>
            </div>
            <p className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-0.5">Aucun message envoyé</p>
            <p className="text-xs text-stone-400 dark:text-stone-500">Les notifications WhatsApp apparaîtront ici</p>
          </div>
        ) : messages.map(msg => {
          const cfg = statusConfig[msg.status] || statusConfig.en_attente;
          const Icon = cfg.icon;
          return (
            <div key={msg.id} className="p-4 hover:bg-stone-50 dark:hover:bg-stone-800">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 dark:text-stone-100 text-sm">{msg.customer_name}</span>
                    <span className="text-xs text-gray-400 dark:text-stone-500">{msg.customer_whatsapp}</span>
                  </div>
                  {msg.tracking_number && <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 dark:text-stone-400">{msg.tracking_number}</span>}
                  <p className="text-xs text-gray-500 dark:text-stone-400 mt-1 line-clamp-2">{msg.message}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Icon size={14} className={cfg.color} />
                  <span className="text-[10px] text-gray-400 dark:text-stone-500">
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
