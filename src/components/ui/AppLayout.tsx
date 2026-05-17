'use client';

import React, { useState } from 'react';
import Sidebar from './Sidebar';
import { ChatbotProvider } from '@/contexts/ChatbotContext';
import ChatbotDrawer from './ChatbotDrawer';
import { Menu, X } from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ChatbotProvider>
      <div className="flex h-screen bg-stone-50 dark:bg-stone-950 overflow-hidden">
        {/* Mobile top bar with menu trigger */}
        <div className="md:hidden fixed top-0 inset-x-0 z-40 h-14 bg-white/90 dark:bg-stone-900/90 backdrop-blur-md border-b border-stone-200 dark:border-stone-800 flex items-center px-4">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
            aria-label="Ouvrir le menu"
          >
            <Menu size={18} />
          </button>
          <div className="ml-3 flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-md flex items-center justify-center shadow-sm shadow-violet-500/30">
              <span className="text-white font-bold text-[10px]">Z</span>
            </div>
            <span className="font-bold text-stone-900 dark:text-stone-100 text-sm tracking-tight">Autotim</span>
          </div>
        </div>

        {/* Mobile overlay */}
        {mobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            className="md:hidden fixed inset-0 z-40 bg-stone-900/40 dark:bg-black/60 backdrop-blur-sm animate-fade-in"
          />
        )}

        {/* Mobile drawer (slides in from left) */}
        <div
          className={`md:hidden fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-out ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="relative h-full">
            <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 -right-3 w-7 h-7 rounded-full bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 shadow-md flex items-center justify-center text-stone-600 dark:text-stone-300"
              aria-label="Fermer le menu"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        <main className="flex-1 overflow-y-auto scrollbar-thin pt-14 md:pt-0">
          {children}
        </main>
      </div>
      <ChatbotDrawer />
    </ChatbotProvider>
  );
}
