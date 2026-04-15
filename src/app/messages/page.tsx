'use client';

import AppLayout from '@/components/ui/AppLayout';
import WhatsAppMessageLog from '../admin-dashboard/components/WhatsAppMessageLog';
import { MessageSquare } from 'lucide-react';

export default function MessagesPage() {
  return (
    <AppLayout>
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <MessageSquare size={20} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Messages WhatsApp</h1>
            <p className="text-sm text-gray-500">Historique de tous vos messages envoyés</p>
          </div>
        </div>
        <div className="max-w-2xl">
          <WhatsAppMessageLog />
        </div>
      </div>
    </AppLayout>
  );
}
