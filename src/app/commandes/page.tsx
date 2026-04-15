'use client';

import AppLayout from '@/components/ui/AppLayout';
import OrdersTable from '../admin-dashboard/components/OrdersTable';
import { Package } from 'lucide-react';

export default function CommandesPage() {
  return (
    <AppLayout>
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <Package size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Commandes</h1>
            <p className="text-sm text-gray-500">Toutes vos commandes ZREXpress</p>
          </div>
        </div>
        <OrdersTable />
      </div>
    </AppLayout>
  );
}
