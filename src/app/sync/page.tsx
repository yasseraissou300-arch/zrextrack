'use client';

import AppLayout from '@/components/ui/AppLayout';
import { RefreshCw } from 'lucide-react';

export default function SyncPage() {
  return (
    <AppLayout>
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <RefreshCw size={20} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Sync ZREXpress</h1>
            <p className="text-sm text-gray-500">Synchronisation avec la plateforme ZREXpress</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center">
          <RefreshCw size={48} className="mx-auto mb-4 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Synchronisation à venir</h2>
          <p className="text-gray-500">La connexion directe avec ZREXpress sera disponible prochainement.</p>
        </div>
      </div>
    </AppLayout>
  );
}
