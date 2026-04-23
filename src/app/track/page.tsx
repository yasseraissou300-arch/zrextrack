'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RefreshCw, Package } from 'lucide-react';
import Link from 'next/link';

export default function TrackRootPage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const go = () => { const t = input.trim(); if (!t) return; setLoading(true); router.push(`/track/${encodeURIComponent(t)}`); };
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-green-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center"><span className="text-white font-bold text-sm">Z</span></div>
            <span className="font-bold text-gray-900 text-[15px]">ZREXTrack</span>
          </Link>
          <span className="text-xs text-gray-400">Suivi de commande</span>
        </div>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center"><div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center"><Package size={32} className="text-green-600" /></div></div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Suivre ma commande</h1>
            <p className="text-gray-500 text-sm">Entrez votre numéro de tracking pour voir le statut en temps réel</p>
          </div>
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="Ex : ZRX123456"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 shadow-sm" autoFocus />
            <button onClick={go} disabled={loading || !input.trim()} className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium px-5 py-3 rounded-xl transition-colors disabled:opacity-50 shadow-sm">
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}{loading ? '' : 'Rechercher'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
