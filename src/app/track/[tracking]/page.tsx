'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Package, CheckCircle2, Truck, Clock, XCircle, RotateCcw, MapPin, RefreshCw, Search, Boxes } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

interface Order {
  tracking: string;
  client?: string;
  wilaya?: string;
  status: string;
  attempts?: number | null;
  last_update?: string | null;
  product?: string;
}

const STATUS_STEPS: { key: string; label: string; icon: LucideIcon; color: string; bg: string; border: string }[] = [
  { key: 'en_preparation', label: 'En préparation', icon: Boxes, color: 'text-purple-500 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-500/15', border: 'border-purple-200 dark:border-purple-500/40' },
  { key: 'en_transit', label: 'En transit', icon: Package, color: 'text-blue-500 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-500/15', border: 'border-blue-200 dark:border-blue-500/40' },
  { key: 'en_livraison', label: 'En livraison', icon: Truck, color: 'text-amber-500 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-500/15', border: 'border-amber-200 dark:border-amber-500/40' },
  { key: 'livre', label: 'Livré', icon: CheckCircle2, color: 'text-green-500 dark:text-green-300', bg: 'bg-green-50 dark:bg-green-500/15', border: 'border-green-200 dark:border-green-500/40' },
];
const STATUS_META: Record<string, { label: string; color: string; bg: string; text: string; icon: LucideIcon }> = {
  en_preparation: { label: 'En préparation', color: 'border-purple-400 dark:border-purple-500/40', bg: 'bg-purple-50 dark:bg-purple-500/10', text: 'text-purple-700 dark:text-purple-300', icon: Boxes },
  en_transit: { label: 'En transit', color: 'border-blue-400 dark:border-blue-500/40', bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-300', icon: Package },
  en_cours: { label: 'En cours', color: 'border-blue-400 dark:border-blue-500/40', bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-300', icon: Package },
  en_livraison: { label: 'En cours de livraison', color: 'border-amber-400 dark:border-amber-500/40', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-300', icon: Truck },
  livre: { label: 'Livré avec succès ✓', color: 'border-green-400 dark:border-green-500/40', bg: 'bg-green-50 dark:bg-green-500/10', text: 'text-green-700 dark:text-green-300', icon: CheckCircle2 },
  echec: { label: 'Échec de livraison', color: 'border-red-400 dark:border-red-500/40', bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-300', icon: XCircle },
  retourne: { label: 'Retourné', color: 'border-stone-400 dark:border-stone-600', bg: 'bg-stone-50 dark:bg-stone-800', text: 'text-stone-600 dark:text-stone-300', icon: RotateCcw },
};
const getStep = (s: string): number => (({ en_preparation: 0, en_cours: 1, en_transit: 1, en_livraison: 2, livre: 3 } as Record<string, number>)[s] ?? -1);

export default function TrackingPage() {
  const params = useParams();
  const tp = typeof params?.tracking === 'string' ? params.tracking : Array.isArray(params?.tracking) ? params.tracking[0] : '';
  const [input, setInput] = useState(tp || '');
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const fetch_ = async (t: string) => {
    if (!t?.trim()) return;
    setLoading(true); setError(''); setSearched(true);
    try {
      const r = await fetch(`/api/track/${encodeURIComponent(t.trim())}`);
      const j = await r.json();
      if (!r.ok || j.error) { setError(j.error || 'Commande introuvable'); setOrder(null); }
      else setOrder(j as Order);
    } catch { setError('Erreur réseau.'); setOrder(null); }
    setLoading(false);
  };

  useEffect(() => { if (tp) fetch_(tp); }, [tp]);
  const meta = order ? (STATUS_META[order.status] || STATUS_META.en_preparation) : null;
  const stepIdx = order ? getStep(order.status) : -1;
  const isTerminal = order ? ['echec', 'retourne'].includes(order.status) : false;

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-white to-violet-50 dark:from-stone-950 dark:via-stone-950 dark:to-stone-900">
      <header className="bg-white dark:bg-stone-900 border-b border-stone-100 dark:border-stone-800 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/track" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex items-center justify-center shadow-sm shadow-violet-500/25"><span className="text-white font-bold text-sm">Z</span></div>
            <span className="font-bold text-stone-900 dark:text-stone-100">Autotim</span>
          </Link>
          <span className="text-xs text-stone-400 dark:text-stone-500">Suivi de commande</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <div className="text-center"><h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 mb-1">Suivre ma commande</h1></div>
        <div className="flex gap-2">
          <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetch_(input)} placeholder="Ex : ZRX123456"
            className="flex-1 border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400 shadow-sm placeholder:text-stone-400 dark:placeholder:text-stone-500" />
          <button onClick={() => fetch_(input)} disabled={loading || !input.trim()}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-medium px-5 py-3 rounded-xl disabled:opacity-50 shadow-sm">
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}{loading ? '' : 'Rechercher'}
          </button>
        </div>
        {searched && error && !loading && <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-2xl p-5 text-center"><XCircle size={28} className="mx-auto mb-2 text-red-400" /><p className="font-semibold text-red-700 dark:text-red-300">{error}</p></div>}
        {order && !loading && meta && (
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-md overflow-hidden">
            <div className={`${meta.bg} border-b ${meta.color} px-6 py-4 flex items-center gap-3`}>
              <meta.icon size={22} className={meta.text} />
              <div><p className="text-xs text-stone-500 dark:text-stone-400 uppercase tracking-wide">Statut actuel</p><p className={`font-bold text-lg ${meta.text}`}>{meta.label}</p></div>
              <div className="ml-auto text-right"><p className="text-xs text-stone-400 dark:text-stone-500">Tracking</p><p className="font-mono font-bold text-stone-800 dark:text-stone-100 text-sm">{order.tracking}</p></div>
            </div>
            {!isTerminal && (
              <div className="px-6 pt-5 pb-2"><div className="flex items-center">
                {STATUS_STEPS.map((step, idx) => { const isA = idx === stepIdx, isDone = idx < stepIdx, Icon = step.icon; return (
                  <div key={step.key} className="flex items-center flex-1 last:flex-none">
                    <div className={`flex flex-col items-center gap-1 ${idx <= stepIdx ? '' : 'opacity-30'}`}>
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 ${isA ? `${step.bg} ${step.border}` : isDone ? 'bg-green-100 dark:bg-green-500/20 border-green-400 dark:border-green-500/50' : 'bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700'}`}>
                        {isDone ? <CheckCircle2 size={16} className="text-green-500 dark:text-green-400" /> : <Icon size={16} className={isA ? step.color : 'text-stone-400 dark:text-stone-500'} />}
                      </div>
                      <span className={`text-[10px] font-medium text-center ${isA ? step.color : isDone ? 'text-green-600 dark:text-green-400' : 'text-stone-400 dark:text-stone-500'}`}>{step.label}</span>
                    </div>
                    {idx < STATUS_STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-1 mb-5 rounded-full ${idx < stepIdx ? 'bg-green-400 dark:bg-green-500/50' : 'bg-stone-200 dark:bg-stone-700'}`} />}
                  </div>); })}
              </div></div>
            )}
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              {order.client && <div className="bg-stone-50 dark:bg-stone-800/60 rounded-xl p-3"><p className="text-[10px] text-stone-400 dark:text-stone-500 uppercase mb-0.5">Client</p><p className="font-semibold text-stone-800 dark:text-stone-100 text-sm">{order.client}</p></div>}
              {order.wilaya && <div className="bg-stone-50 dark:bg-stone-800/60 rounded-xl p-3"><p className="text-[10px] text-stone-400 dark:text-stone-500 uppercase mb-0.5 flex items-center gap-1"><MapPin size={9} />Wilaya</p><p className="font-semibold text-stone-800 dark:text-stone-100 text-sm">{order.wilaya}</p></div>}
              {order.product && <div className="bg-stone-50 dark:bg-stone-800/60 rounded-xl p-3"><p className="text-[10px] text-stone-400 dark:text-stone-500 uppercase mb-0.5">Produit</p><p className="font-semibold text-stone-800 dark:text-stone-100 text-sm">{order.product}</p></div>}
              {order.attempts != null && <div className="bg-stone-50 dark:bg-stone-800/60 rounded-xl p-3"><p className="text-[10px] text-stone-400 dark:text-stone-500 uppercase mb-0.5">Tentatives</p><p className="font-semibold text-stone-800 dark:text-stone-100 text-sm">{order.attempts}</p></div>}
            </div>
            {order.last_update && <div className="px-6 pb-4 flex items-center gap-1.5">
              <Clock size={12} className="text-stone-400 dark:text-stone-500" />
              <p className="text-xs text-stone-400 dark:text-stone-500">Mis à jour le <span className="font-medium text-stone-600 dark:text-stone-300">{new Date(order.last_update).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></p>
              <button onClick={() => fetch_(order.tracking)} className="ml-auto flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 font-medium"><RefreshCw size={11} />Actualiser</button>
            </div>}
            {order.status === 'echec' && <div className="mx-6 mb-4 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/30 rounded-xl p-3 text-xs text-red-700 dark:text-red-300">⚠️ Notre livreur n'a pas pu vous joindre. Contactez le vendeur.</div>}
            {order.status === 'retourne' && <div className="mx-6 mb-4 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl p-3 text-xs text-stone-600 dark:text-stone-300">📦 Colis retourné. Contactez le vendeur.</div>}
            {order.status === 'livre' && <div className="mx-6 mb-4 bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/30 rounded-xl p-3 text-xs text-green-700 dark:text-green-300 text-center">🎉 Livré avec succès. Merci pour votre confiance !</div>}
          </div>
        )}
      </main>
    </div>
  );
}
