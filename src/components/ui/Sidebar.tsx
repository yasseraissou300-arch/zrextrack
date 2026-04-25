'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Package, MessageSquare, BarChart3, Settings,
  ChevronLeft, ChevronRight, Truck, Bell, RefreshCw, Users, Trash2, Megaphone, Plug, MessageCircle,
} from 'lucide-react';
import { useChatbot } from '@/contexts/ChatbotContext';

const navGroups = [
  {
    label: 'Principal',
    items: [
      { href: '/admin-dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
      { href: '/commandes', icon: Package, label: 'Commandes' },
      { href: '/livraisons', icon: Truck, label: 'Livraisons' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { href: '/messages', icon: MessageSquare, label: 'Messages WhatsApp' },
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

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { toggle, isOpen } = useChatbot();

  return (
    <aside
      className={`relative flex flex-col bg-white border-r border-gray-200 transition-all duration-300 ease-in-out shrink-0 ${
        collapsed ? 'w-[60px]' : 'w-[220px]'
      }`}
    >
      {/* Logo */}
      <div
        className={`flex items-center border-b border-gray-100 min-h-[60px] ${
          collapsed ? 'justify-center px-3' : 'gap-2.5 px-4'
        }`}
      >
        <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-sm">Z</span>
        </div>
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-[15px] text-gray-900 tracking-tight">ZREXTrack</span>
            <span className="text-[10px] text-gray-400 font-medium tracking-wide uppercase">ZREXpress</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-5">
            {!collapsed && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 px-2 mb-1.5">
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
                      title={collapsed ? item.label : undefined}
                      className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-green-50 text-green-700'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                      } ${collapsed ? 'justify-center' : ''}`}
                    >
                      {isActive && !collapsed && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-green-500 rounded-r-full" />
                      )}
                      <Icon size={17} className="shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {collapsed && (
                        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-md">
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
      <div className="border-t border-gray-100 p-2 space-y-0.5">
        {/* Chatbot button */}
        <button
          onClick={toggle}
          title={collapsed ? 'Assistant IA' : undefined}
          className={`group relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
            isOpen
              ? 'bg-green-50 text-green-700'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
          } ${collapsed ? 'justify-center' : ''}`}
        >
          {isOpen && !collapsed && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-green-500 rounded-r-full" />
          )}
          <div className="relative shrink-0">
            <MessageCircle size={17} />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-white" />
          </div>
          {!collapsed && <span className="truncate">Assistant IA</span>}
          {collapsed && (
            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-md">
              Assistant IA
            </div>
          )}
        </button>

        <Link
          href="/parametres"
          title={collapsed ? 'Paramètres' : undefined}
          className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-all duration-150 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Settings size={17} className="shrink-0" />
          {!collapsed && <span>Paramètres</span>}
          {collapsed && (
            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-md">
              Paramètres
            </div>
          )}
        </Link>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[68px] w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 transition-colors z-10"
      >
        {collapsed ? <ChevronRight size={12} className="text-gray-500" /> : <ChevronLeft size={12} className="text-gray-500" />}
      </button>
    </aside>
  );
}
