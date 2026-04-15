'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Package, MessageSquare, BarChart3, Settings,
  ChevronLeft, ChevronRight, Truck, Bell, RefreshCw, Users, AlertTriangle,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';

const navGroups = [
  {
    label: 'Principal',
    items: [
      { href: '/admin-dashboard', icon: LayoutDashboard, label: 'Tableau de bord', badge: null },
      { href: '/commandes', icon: Package, label: 'Commandes', badge: null },
      { href: '/livraisons', icon: Truck, label: 'Livraisons', badge: null },
    ],
  },
  {
    label: 'Communication',
    items: [
      { href: '/messages', icon: MessageSquare, label: 'Messages WhatsApp', badge: null },
      { href: '/alertes', icon: Bell, label: 'Alertes', badge: null },
      { href: '/clients', icon: Users, label: 'Clients', badge: null },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { href: '/rapports', icon: BarChart3, label: 'Rapports', badge: null },
      { href: '/sync', icon: RefreshCw, label: 'Sync ZREXpress', badge: null },
    ],
  },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside className={`relative flex flex-col bg-white border-r border-[hsl(var(--border))] transition-all duration-300 ease-in-out shrink-0 ${collapsed ? 'w-16' : 'w-60'}`}>
      {/* Logo */}
      <div className={`flex items-center gap-2.5 px-4 py-4 border-b border-[hsl(var(--border))] min-h-[64px] ${collapsed ? 'justify-center px-2' : ''}`}>
        <AppLogo size={32} />
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-[15px] text-[hsl(var(--foreground))] tracking-tight">ZREXTrack</span>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-medium tracking-wide uppercase">ZREXpress</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="text-[10px] font-600 uppercase tracking-widest text-[hsl(var(--muted-foreground))] px-2 mb-1.5">
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
                      className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-[hsl(var(--accent))] text-[hsl(var(--primary))]'
                          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]'
                      } ${collapsed ? 'justify-center' : ''}`}
                    >
                      <Icon size={18} className="shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {collapsed && (
                        <div className="absolute left-full ml-2 px-2 py-1 bg-[hsl(var(--foreground))] text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
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
      <div className="border-t border-[hsl(var(--border))] p-2 space-y-0.5">
        <Link href="/parametres" className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] transition-all duration-150 ${collapsed ? 'justify-center' : ''}`}>
          <Settings size={18} className="shrink-0" />
          {!collapsed && <span>Paramètres</span>}
        </Link>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[72px] w-6 h-6 bg-white border border-[hsl(var(--border))] rounded-full flex items-center justify-center shadow-sm hover:bg-[hsl(var(--secondary))] transition-colors z-10"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  );
}
