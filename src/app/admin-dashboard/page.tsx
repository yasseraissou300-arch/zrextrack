import React from 'react';
import AppLayout from '@/components/ui/AppLayout';
import DashboardHeader from './components/DashboardHeader';
import HomeOverview from './components/HomeOverview';
import RecentOrders from './components/RecentOrders';
import OnboardingChecklist from '@/components/OnboardingChecklist';
import QuotaBanner from '@/components/QuotaBanner';
import { Toaster } from 'sonner';

// Accueil (refonte) : en-tête, bandeau d'action éventuel, chiffres clés,
// courbe des livraisons, « À faire » et dernières commandes. Les vues
// détaillées (tableau complet, répartition, journal WhatsApp) vivent dans
// Commandes, Rapports et Messages.
export default function AdminDashboardPage() {
  return (
    <AppLayout>
      <Toaster position="bottom-right" richColors />
      <div className="max-w-[1120px] mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-10 space-y-6">
        <DashboardHeader />
        <OnboardingChecklist />
        <QuotaBanner />
        <HomeOverview>
          <RecentOrders />
        </HomeOverview>
      </div>
    </AppLayout>
  );
}
