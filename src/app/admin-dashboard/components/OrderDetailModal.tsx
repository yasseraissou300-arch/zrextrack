'use client';

import React from 'react';
import { X, MapPin, Phone, Package, Truck, Clock, CreditCard, RotateCcw, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type Status = 'en_preparation' | 'en_transit' | 'en_livraison' | 'livre' | 'echec' | 'retourne';

interface Order {
  id: string;
  tracking_number: string;
  customer_name: string;
  customer_whatsapp: string;
  product_name: string;
  wilaya: string;
  district: string;
  delivery_status: Status;
  situation: string;
  delivery_type: string;
  delivery_fees: number;
  last_update: string;
  attempts: number;
  cod: number;
}

const STATUS_CONFIG: Record<string, { label: string; badge: string; bg: string; border: string }> = {
  en_preparation: { label: 'En préparation', badge: 'bg-purple-100 text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
  en_transit:     { label: 'En transit',      badge: 'bg-blue-100 text-blue-700',    bg: 'bg-blue-50',   border: 'border-blue-200' },
  en_livraison:   { label: 'En livraison',    badge: 'bg-amber-100 text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  livre:          { label: 'Livré ✓',         badge: 'bg-green-100 text-green-700',  bg: 'bg-green-50',  border: 'border-green-200' },
  echec:          { label: 'Échec',           badge: 'bg-red-100 text-red-700',      bg: 'bg-red-50',    border: 'border-red-200' },
  retourne:       { label: 'Retourné',        badge: 'bg-gray-100 text-gray-600',    bg: 'bg-gray-50',   border: 'border-gray-200' },
};

const STEPS = ['en_preparation', 'en_transit', 'en_livraison', 'livre'];
const STEP_LABELS = ['Préparation', 'Transit', 'Livraison', 'Livré'];

function getStepIndex(status: string) {
  return STEPS.indexOf(status);
}

interface Props {
  order: Order | null;
  onClose: () => void;
  onDeleted?: () => void;
}

export default function OrderDetailModal({ order, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = React.useState(false);
  if (!order) return null;

  const meta = STATUS_CONFIG[order.delivery_status] || STATUS_CONFIG.en_preparation;
  const stepIdx = getStepIndex(order.delivery_status);
  const isTerminal = ['echec', 'retourne'].includes(order.delivery_status);
  const trackingUrl = `/track/${order.tracking_number}`;

  const handleDelete = async () => {
    if (!confirm(`Mettre la commande ${order.tracking_number} à la corbeille ?`)) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/orders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [order.id] }),
      });
      const json = await res.json();
      if (json.error) { toast.error(json.error); }
      else {
        toast.success(`Commande ${order.tracking_number} déplacée à la corbeille`);
        onDeleted?.();
        onClose();
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setDeleting(false); }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

        {/* Header statut */}
        <div className={`${meta.bg} border-b ${meta.border} px-6 py-4 flex items-start justify-between`}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${meta.badge}`}>
                {meta.label}
              </span>
              {order.situation && order.situation !== meta.label && (
                <span className="text-xs text-gray-500">{order.situation}</span>
              )}
            </div>
            <p className="font-mono font-bold text-gray-900 text-lg">{order.tracking_number}</p>
            <p className="text-sm text-gray-500 mt-0.5">{order.customer_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              title="Voir page de suivi"
            >
              <ExternalLink size={14} className="text-gray-500" />
            </a>
            <button
              onClick={onClose}
              className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
            >
              <X size={14} className="text-gray-500" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">

          {/* Barre de progression */}
          {!isTerminal && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Progression</p>
              <div className="flex items-center">
                {STEPS.map((step, idx) => {
                  const isActive = idx === stepIdx;
                  const isDone = idx < stepIdx;
                  return (
                    <React.Fragment key={step}>
                      <div className="flex flex-col items-center gap-1">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all ${
                          isDone ? 'bg-green-500 border-green-500 text-white'
                            : isActive ? 'bg-white border-green-500 text-green-600'
                            : 'bg-white border-gray-200 text-gray-300'
                        }`}>
                          {isDone ? '✓' : idx + 1}
                        </div>
                        <span className={`text-[10px] font-medium text-center leading-tight ${
                          isDone ? 'text-green-600' : isActive ? 'text-gray-800' : 'text-gray-300'
                        }`}>{STEP_LABELS[idx]}</span>
                      </div>
                      {idx < STEPS.length - 1 && (
                        <div className={`flex-1 h-0.5 mx-1 mb-4 rounded-full ${idx < stepIdx ? 'bg-green-400' : 'bg-gray-200'}`} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}

          {/* Infos client */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Client</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-400 mb-0.5">Nom</p>
                <p className="text-sm font-semibold text-gray-800">{order.customer_name || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1"><Phone size={9}/>WhatsApp</p>
                <p className="text-sm font-semibold text-gray-800">{order.customer_whatsapp || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1"><MapPin size={9}/>Wilaya</p>
                <p className="text-sm font-semibold text-gray-800">{order.wilaya || '—'}</p>
              </div>
              {order.district && order.district !== order.wilaya && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 mb-0.5">Commune</p>
                  <p className="text-sm font-semibold text-gray-800">{order.district}</p>
                </div>
              )}
            </div>
          </div>

          {/* Infos commande */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Commande</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-xl p-3 col-span-2">
                <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1"><Package size={9}/>Produit</p>
                <p className="text-sm font-semibold text-gray-800">{order.product_name || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1"><CreditCard size={9}/>Montant COD</p>
                <p className="text-sm font-bold text-gray-900">
                  {order.cod ? `${Number(order.cod).toLocaleString('fr-DZ')} DA` : '—'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1"><Truck size={9}/>Frais livraison</p>
                <p className="text-sm font-semibold text-gray-800">
                  {order.delivery_fees ? `${Number(order.delivery_fees).toLocaleString('fr-DZ')} DA` : '—'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1"><Truck size={9}/>Type livraison</p>
                <p className="text-sm font-semibold text-gray-800">{order.delivery_type || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1"><RotateCcw size={9}/>Tentatives</p>
                <p className="text-sm font-bold text-gray-900">{order.attempts ?? 0}</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Clock size={11} />
              Mis à jour le <span className="font-medium text-gray-600 ml-1">{formatDate(order.last_update)}</span>
            </div>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-500 text-xs font-medium hover:bg-red-50 transition-all disabled:opacity-50"
            >
              <Trash2 size={12} />
              {deleting ? 'Suppression...' : 'Corbeille'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
