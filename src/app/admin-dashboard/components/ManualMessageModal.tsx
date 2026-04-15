'use client';

import React, { useState } from 'react';
import { X, MessageSquare, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Order {
  id: string;
  tracking: string;
  client: string;
  whatsapp: string;
  product: string;
  status: string;
}

interface Props {
  order: Order;
  onClose: () => void;
}

const templates = [
  {
    id: 'tpl-confirmed',
    label: 'Commande confirmée',
    text: (o: Order) =>
      `Bonjour ${o.client.split(' ')[0]} 👋\n\nVotre commande *${o.tracking}* pour *${o.product}* est enregistrée chez ZREXpress.\n\nNous vous notifierons à chaque étape de la livraison. Merci pour votre confiance ! 🙏`,
  },
  {
    id: 'tpl-transit',
    label: 'En cours de livraison',
    text: (o: Order) =>
      `Bonjour ${o.client.split(' ')[0]} 🚚\n\nVotre colis *${o.tracking}* est en route vers vous !\n\nVotre livreur ZREXpress passera aujourd'hui. Assurez-vous d'être disponible.`,
  },
  {
    id: 'tpl-delivered',
    label: 'Livraison réussie',
    text: (o: Order) =>
      `Bonjour ${o.client.split(' ')[0]} ✅\n\nVotre commande *${o.tracking}* a été livrée avec succès !\n\nMerci pour votre achat. N'hésitez pas à nous laisser votre avis. 🌟`,
  },
  {
    id: 'tpl-failed',label: 'Tentative échouée',
    text: (o: Order) =>
      `Bonjour ${o.client.split(' ')[0]} ⚠️\n\nNous n'avons pas pu livrer votre colis *${o.tracking}* aujourd'hui.\n\nMerci de nous contacter pour reprogrammer la livraison.`,
  },
  {
    id: 'tpl-custom',label: 'Message personnalisé',
    text: () => '',
  },
];

export default function ManualMessageModal({ order, onClose }: Props) {
  const [selectedTemplate, setSelectedTemplate] = useState('tpl-transit');
  const [message, setMessage] = useState(
    templates.find((t) => t.id === 'tpl-transit')!.text(order)
  );
  const [sending, setSending] = useState(false);

  const handleTemplateChange = (id: string) => {
    setSelectedTemplate(id);
    const tpl = templates.find((t) => t.id === id)!;
    setMessage(tpl.text(order));
  };

  const handleSend = () => {
    if (!message.trim()) return;
    setSending(true);
    // TODO: Connect to WhatsApp Business API POST /api/whatsapp/send { to: order.whatsapp, message }
    setTimeout(() => {
      setSending(false);
      toast.success(`Message envoyé à ${order.client}`, {
        description: `${order.whatsapp} · ${order.tracking}`,
      });
      onClose();
    }, 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
              <MessageSquare size={16} className="text-green-700" />
            </div>
            <div>
              <h3 className="text-sm font-600 text-[hsl(var(--foreground))]">Envoyer un message WhatsApp</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{order.client} · {order.whatsapp}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Order info */}
        <div className="px-6 py-3 bg-[hsl(var(--secondary))]/40 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-[hsl(var(--muted-foreground))]">Commande :</span>
            <span className="font-semibold tabular-nums text-[hsl(var(--foreground))]">{order.tracking}</span>
            <span className="text-[hsl(var(--muted-foreground))]">·</span>
            <span className="text-[hsl(var(--foreground))] truncate">{order.product}</span>
          </div>
        </div>

        {/* Template selector */}
        <div className="px-6 pt-4 pb-3">
          <label className="block text-xs font-600 text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-2">
            Modèle de message
          </label>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTemplateChange(t.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150 ${
                  selectedTemplate === t.id
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--border))]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Message textarea */}
        <div className="px-6 pb-4">
          <label className="block text-xs font-600 text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-2">
            Message
          </label>
          <textarea
            value={message}
            onChange={(e) => { setMessage(e.target.value); setSelectedTemplate('tpl-custom'); }}
            rows={6}
            className="w-full px-3.5 py-3 text-sm bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:border-transparent transition-all font-mono text-xs leading-relaxed"
            placeholder="Rédigez votre message..."
          />
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1.5">
            {message.length} caractères · Sera envoyé via WhatsApp Business API
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/30">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[hsl(var(--border))] text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-white transition-all duration-150 active:scale-95"
          >
            Annuler
          </button>
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--primary))] text-white text-sm font-medium hover:bg-green-700 transition-all duration-150 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed min-w-[130px] justify-center"
          >
            {sending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Envoi en cours...
              </>
            ) : (
              <>
                <Send size={14} />
                Envoyer le message
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}