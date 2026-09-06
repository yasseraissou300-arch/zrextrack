'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RefreshCw, Package } from 'lucide-react';
import Link from 'next/link';

export default function TrackRootPage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const go = () => {
    const t = input.trim();
    if (!t) return;
    setLoading(true);
    router.push(`/track/${encodeURIComponent(t)}`);
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-white to-violet-50 dark:from-stone-950 dark:via-stone-950 dark:to-stone-900 flex flex-col">
      <header className="bg-white dark:bg-stone-900 border-b border-stone-100 dark:border-stone-800 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex items-center justify-center shadow-sm shadow-violet-500/25">
              <span className="text-white font-bold text-sm">Z</span>
            </div>
            <span className="font-bold text-stone-900 dark:text-stone-100 text-[15px]">
              Autotim
            </span>
          </Link>
          <span className="text-xs text-stone-400 dark:text-stone-500">Suivi de commande</span>
        </div>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-violet-100 dark:bg-violet-500/15 rounded-2xl flex items-center justify-center">
              <Package size={32} className="text-violet-600 dark:text-violet-300" />
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 mb-2">
              Suivre ma commande
            </h1>
            <p className="text-stone-500 dark:text-stone-400 text-sm">
              Entrez votre numéro de tracking pour voir le statut en temps réel
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              placeholder="Ex : ZRX123456"
              className="flex-1 border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400 shadow-sm placeholder:text-stone-400 dark:placeholder:text-stone-500"
              autoFocus
            />
            <button
              onClick={go}
              disabled={loading || !input.trim()}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-medium px-5 py-3 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
              {loading ? '' : 'Rechercher'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
