'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Package, CheckCircle2, Truck, Clock, XCircle, RotateCcw, MapPin, RefreshCw, Search, Boxes } from 'lucide-react';
import Link from 'next/link';

const STATUS_STEPS = [
  { key: 'en_preparation', label: 'En préparation', icon: Boxes, color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-200' },
  { key: 'en_transit', label: 'En transit', icon: Package, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
  { key: 'en_livraison', label: 'En livraison', icon: Truck, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200' },
  { key: 'livre', label: 'Livré', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
];
const STATUS_META = {
  en_preparation: { label: 'En préparation', color: 'border-purple-400', bg: 'bg-purple-50', text: 'text-purple-700', icon: Boxes },
  en_transit: { label: 'En transit', color: 'border-blue-400', bg: 'bg-blue-50', text: 'text-blue-700', icon: Package },
  en_cours: { label: 'En cours', color: 'border-blue-400', bg: 'bg-blue-50', text: 'text-blue-700', icon: Package },
  en_livraison: { label: 'En cours de livraison', color: 'border-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', icon: Truck },
  livre: { label: 'Livré avec succès ✓', color: 'border-green-400', bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2 },
  echec: { label: 'Échec de livraison', color: 'border-red-400', bg: 'bg-red-50', text: 'text-red-700', icon: XCircle },
  retourne: { label: 'Retourné', color: 'border-gray-400', bg: 'bg-gray-50', text: 'text-gray-600', icon: RotateCcw },
};
const getStep = (s) => ({ en_preparation:0, en_cours:1, en_transit:1, en_livraison:2, livre:3 })[s] ?? -1;

export default function TrackingPage() {
  const params = useParams();
  const tp = params?.tracking;
  const [input, setInput] = useState(tp || '');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const fetch_ = async (t) => {
    if (!t?.trim()) return;
    setLoading(true); setError(''); setSearched(true);
    try {
      const r = await fetch(`/api/track/${encodeURIComponent(t.trim())}`);
      const j = await r.json();
      if (!r.ok || j.error) { setError(j.error || 'Commande introuvable'); setOrder(null); }
      else setOrder(j);
    } catch { setError('Erreur réseau.'); setOrder(null); }
    setLoading(false);
  };

  useEffect(() => { if (tp) fetch_(tp); }, [tp]);
  const meta = order ? (STATUS_META[order.status] || STATUS_META.en_preparation) : null;
  const stepIdx = order ? getStep(order.status) : -1;
  const isTerminal = order && ['echec','retourne'].includes(order.status);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-green-50">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/track" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center"><span className="text-white font-bold text-sm">Z</span></div>
            <span className="font-bold text-gray-900">ZREXTrack</span>
          </Link>
          <span className="text-xs text-gray-400">Suivi de commande</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <div className="text-center"><h1 className="text-2xl font-bold text-gray-900 mb-1">Suivre ma commande</h1></div>
        <div className="flex gap-2">
          <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key==='Enter' && fetch_(input)} placeholder="Ex : ZRX123456"
            className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 shadow-sm" />
          <button onClick={() => fetch_(input)} disabled={loading || !input.trim()}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium px-5 py-3 rounded-xl disabled:opacity-50 shadow-sm">
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}{loading ? '' : 'Rechercher'}
          </button>
        </div>
        {searched && error && !loading && <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center"><XCircle size={28} className="mx-auto mb-2 text-red-400" /><p className="font-semibold text-red-700">{error}</p></div>}
        {order && !loading && meta && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden">
            <div className={`${meta.bg} border-b ${meta.color} px-6 py-4 flex items-center gap-3`}>
              <meta.icon size={22} className={meta.text} />
              <div><p className="text-xs text-gray-500 uppercase tracking-wide">Statut actuel</p><p className={`font-bold text-lg ${meta.text}`}>{meta.label}</p></div>
              <div className="ml-auto text-right"><p className="text-xs text-gray-400">Tracking</p><p className="font-mono font-bold text-gray-800 text-sm">{order.tracking}</p></div>
            </div>
            {!isTerminal && (
              <div className="px-6 pt-5 pb-2"><div className="flex items-center">
                {STATUS_STEPS.map((step, idx) => { const isA=idx===stepIdx,isDone=idx<stepIdx,Icon=step.icon; return (
                  <div key={step.key} className="flex items-center flex-1 last:flex-none">
                    <div className={`flex flex-col items-center gap-1 ${idx<=stepIdx?'':'opacity-30'}`}>
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 ${isA?`${step.bg} ${step.border}`:isDone?'bg-green-100 border-green-400':'bg-gray-50 border-gray-200'}`}>
                        {isDone?<CheckCircle2 size={16} className="text-green-500"/>:<Icon size={16} className={isA?step.color:'text-gray-400'}/>}
                      </div>
                      <span className={`text-[10px] font-medium text-center ${isA?step.color:isDone?'text-green-600':'text-gray-400'}`}>{step.label}</span>
                    </div>
                    {idx<STATUS_STEPS.length-1 && <div className={`flex-1 h-0.5 mx-1 mb-5 rounded-full ${idx<stepIdx?'bg-green-400':'bg-gray-200'}`}/>}
                  </div>); })}
              </div></div>
            )}
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              {order.client && <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] text-gray-400 uppercase mb-0.5">Client</p><p className="font-semibold text-gray-800 text-sm">{order.client}</p></div>}
              {order.wilaya && <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] text-gray-400 uppercase mb-0.5 flex items-center gap-1"><MapPin size={9}/>Wilaya</p><p className="font-semibold text-gray-800 text-sm">{order.wilaya}</p></div>}
              {order.product && <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] text-gray-400 uppercase mb-0.5">Produit</p><p className="font-semibold text-gray-800 text-sm">{order.product}</p></div>}
              {order.attempts!=null && <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] text-gray-400 uppercase mb-0.5">Tentatives</p><p className="font-semibold text-gray-800 text-sm">{order.attempts}</p></div>}
            </div>
            {order.last_update && <div className="px-6 pb-4 flex items-center gap-1.5">
              <Clock size={12} className="text-gray-400"/>
              <p className="text-xs text-gray-400">Mis à jour le <span className="font-medium text-gray-600">{new Date(order.last_update).toLocaleString('fr-FR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span></p>
              <button onClick={()=>fetch_(order.tracking)} className="ml-auto flex items-center gap-1 text-xs text-green-600 font-medium"><RefreshCw size={11}/>Actualiser</button>
            </div>}
            {order.status==='echec' && <div className="mx-6 mb-4 bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700">⚠️ Notre livreur n'a pas pu vous joindre. Contactez le vendeur.</div>}
            {order.status==='retourne' && <div className="mx-6 mb-4 bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600">📦 Colis retourné. Contactez le vendeur.</div>}
            {order.status==='livre' && <div className="mx-6 mb-4 bg-green-50 border border-green-100 rounded-xl p-3 text-xs text-green-700 text-center">🎉 Livré avec succès. Merci pour votre confiance !</div>}
          </div>
        )}
      </main>
    </div>
  );
}
