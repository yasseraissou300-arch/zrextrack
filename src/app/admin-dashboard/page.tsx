import React from 'react';
import AppLayout from '@/components/ui/AppLayout';
import DashboardHeader from './components/DashboardHeader';
import KPIBentoGrid from './components/KPIBentoGrid';
import AlertsPanel from './components/AlertsPanel';
import ChartsRow from './components/ChartsRow';
import OrdersTable from './components/OrdersTable';
import WhatsAppMessageLog from './components/WhatsAppMessageLog';
import { Toaster } from 'sonner';

export default function AdminDashboardPage() {
  return (
    <AppLayout>
      <Toaster position="bottom-right" richColors />
      <div className="min-h-screen bg-[hsl(var(--background))]">
        <div className="max-w-screen-2xl mx-auto px-6 lg:px-8 xl:px-10 py-6 space-y-6">
          <DashboardHeader />
          <KPIBentoGrid />
          <AlertsPanel />
          <ChartsRow />
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <OrdersTable />
            </div>
            <div className="xl:col-span-1">
              <WhatsAppMessageLog />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}