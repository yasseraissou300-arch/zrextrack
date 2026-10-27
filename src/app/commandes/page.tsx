'use client';

import AppLayout from '@/components/ui/AppLayout';
import OrdersTable from '../admin-dashboard/components/OrdersTable';
import { Toaster } from 'sonner';

export default function CommandesPage() {
  return (
    <AppLayout>
      <Toaster position="bottom-right" richColors />
      <div className="max-w-[1120px] mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10 space-y-5">
        <h1 className="text-[26px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Commandes
        </h1>
        <OrdersTable />
      </div>
    </AppLayout>
  );
}
