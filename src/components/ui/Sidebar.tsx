'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Package, MessageSquare, BarChart3, Settings,
  ChevronLeft, ChevronRight, Truck, Bell, RefreshCw, Users, Trash2, Megaphone, Plug, MessageCircle, Bot, Repeat,
  Sun, Moon,
} from 'lucide-react';
import { useChatbot } from '@/contexts/ChatbotContext';
import { useTheme } from '@/contexts/ThemeContext';

const navGroups = [
  {
    label: 'Principal',
    items: [
      { href: '/admin-dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
      { href: '/commandes', icon: Package, label: 'Commandes' },
      { href: '/livraisons', icon: Truck, label: 'Livraisons' },
      { href: '/autoswap', icon: Repeat, label: 'AutoSwap' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { href: '/messages', icon: MessageSquare, label: 'Messages WhatsApp' },
      { href: '/ai-chatbot', icon: Bot, label: 'AI Chatbot' },
      { href: '/campagnes', icon: Megaphone, label: 'Campagnes' },
      { href: '/alertes', icon: Bell, label: 'Alertes' },
      { href: '/clients', icon: Users, label: 'Clients' },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { href: '/rapports', icon: BarChart3, label: 'Rapports' },
      { href: '/sync', icon: RefreshCw, label: 'Sync ZREXpress' },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { href: '/integrations', icon: Plug, label: 'Intégrations' },
      { href: '/corbeille', icon: Trash2, label: 'Corbeille' },
    ],
  },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { toggle, isOpen } = useChatbot();
  const { theme, toggle: toggleTheme } = useTheme();

  // Reset collapsed when in mobile drawer mode
  const isMobile = mobileOpen !== undefined && onMobileClose !== undefined;
  const effectivelyCollapsed = isMobile ? false : collapsed;

  return (
    <aside
      // h-screen + flex-col garantit que la nav (flex-1) prenne tout l'espace dispo
      // et puisse scroller en interne via overflow-y-auto. Sans h-screen explicite,
      // l'aside prenait la hauteur naturelle de son contenu et débordait du viewport
      // sur les petits écrans → les items du bas (Gestion, Paramètres) devenaient
      // inaccessibles.
      className={`relative flex flex-col h-screen bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 transition-all duration-300 ease-in-out shrink-0 ${
        effectivelyCollapsed ? 'w-[60px]' : 'w-[220px]'
      }`}
    >
      {/* Logo */}
      <div
        className={`flex items-center border-b border-stone-100 dark:border-stone-800 min-h-[60px] ${
          effectivelyCollapsed ? 'justify-center px-3' : 'gap-2.5 px-4'
        }`}
      >
        <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex items-center justify-center shrink-0 shadow-sm shadow-violet-500/25">
          <span className="text-white font-bold text-xs">Z</span>
        </div>
        {!effectivelyCollapsed && (
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-[15px] text-stone-900 dark:text-stone-100 tracking-tight">Autotim</span>
            <span className="text-[10px] text-stone-400 dark:text-stone-500 font-medium tracking-wide uppercase">ZREXpress</span>
          </div>
        )}
      </div>

      {/* Nav — min-h-0 indispensable pour qu'overflow-y-auto fonctionne dans un parent flex */}
      <nav className="flex-1 min-h-0 overflow-y-auto py-3 px-2">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-5">
            {!effectivelyCollapsed && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500 px-2 mb-1.5">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      onClick={onMobileClose}
                      title={effectivelyCollapsed ? item.label : undefined}
                      className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300'
                          : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'
                      } ${effectivelyCollapsed ? 'justify-center' : ''}`}
                    >
                      {isActive && !effectivelyCollapsed && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-violet-500 rounded-r-full" />
                      )}
                      <Icon size={15} className="shrink-0" />
                      {!effectivelyCollapsed && <span className="truncate">{item.label}</span>}
                      {effectivelyCollapsed && (
                        <div className="absolute left-full ml-2 px-2 py-1 bg-stone-800 dark:bg-stone-700 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-md">
                          {item.label}
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-stone-100 dark:border-stone-800 p-2 space-y-0.5">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={effectivelyCollapsed ? (theme === 'dark' ? 'Mode clair' : 'Mode sombre') : undefined}
          className={`group relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-stone-500 hover:bg-stone-50 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 transition-all duration-150 ${effectivelyCollapsed ? 'justify-center' : ''}`}
        >
          {theme === 'dark' ? <Sun size={15} className="shrink-0" /> : <Moon size={15} className="shrink-0" />}
          {!effectivelyCollapsed && <span className="truncate">{theme === 'dark' ? 'Mode clair' : 'Mode sombre'}</span>}
          {effectivelyCollapsed && (
            <div className="absolute left-full ml-2 px-2 py-1 bg-stone-800 dark:bg-stone-700 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-md">
              {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            </div>
          )}
        </button>

        {/* Chatbot button */}
        <button
          onClick={toggle}
          title={effectivelyCollapsed ? 'Assistant IA' : undefined}
          className={`group relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
            isOpen
              ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300'
              : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'
          } ${effectivelyCollapsed ? 'justify-center' : ''}`}
        >
          {isOpen && !effectivelyCollapsed && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-violet-500 rounded-r-full" />
          )}
          <div className="relative shrink-0">
            <MessageCircle size={15} />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-violet-500 rounded-full border border-white dark:border-stone-900" />
          </div>
          {!effectivelyCollapsed && <span className="truncate">Assistant IA</span>}
          {effectivelyCollapsed && (
            <div className="absolute left-full ml-2 px-2 py-1 bg-stone-800 dark:bg-stone-700 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-md">
              Assistant IA
            </div>
          )}
        </button>

        <Link
          href="/parametres"
          onClick={onMobileClose}
          title={effectivelyCollapsed ? 'Paramètres' : undefined}
          className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-stone-500 hover:bg-stone-50 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 transition-all duration-150 ${
            effectivelyCollapsed ? 'justify-center' : ''
          }`}
        >
          <Settings size={15} className="shrink-0" />
          {!effectivelyCollapsed && <span>Paramètres</span>}
          {effectivelyCollapsed && (
            <div className="absolute left-full ml-2 px-2 py-1 bg-stone-800 dark:bg-stone-700 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-md">
              Paramètres
            </div>
          )}
        </Link>
      </div>

      {/* Collapse toggle — hidden on mobile drawer */}
      {!isMobile && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex absolute -right-3 top-[68px] w-6 h-6 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-full items-center justify-center shadow-sm hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors z-10"
        >
          {collapsed ? <ChevronRight size={12} className="text-stone-500 dark:text-stone-400" /> : <ChevronLeft size={12} className="text-stone-500 dark:text-stone-400" />}
        </button>
      )}
    </aside>
  );
}
