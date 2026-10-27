'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Package,
  Repeat,
  MessageCircle,
  Users,
  LineChart,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Sparkles,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { useChatbot } from '@/contexts/ChatbotContext';
import { useTheme } from '@/contexts/ThemeContext';

// Navigation volontairement courte : 6 sections. Les pages secondaires restent
// accessibles comme sous-liens, affichés seulement quand leur section est
// ouverte — aucune page n'a été retirée, elles sont regroupées.
interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  children?: { href: string; label: string }[];
}

const mainNav: NavItem[] = [
  { href: '/admin-dashboard', icon: Home, label: 'Accueil' },
  {
    href: '/commandes',
    icon: Package,
    label: 'Commandes',
    children: [
      { href: '/commandes', label: 'Toutes les commandes' },
      { href: '/livraisons', label: 'Livraisons' },
      { href: '/alertes', label: 'Alertes' },
      { href: '/corbeille', label: 'Corbeille' },
    ],
  },
  { href: '/autoswap', icon: Repeat, label: 'AutoSwap' },
  {
    href: '/messages',
    icon: MessageCircle,
    label: 'Messages',
    children: [
      { href: '/messages', label: 'WhatsApp' },
      { href: '/ai-chatbot', label: 'Chatbot IA' },
      { href: '/campagnes', label: 'Campagnes' },
      { href: '/voice-calls', label: 'Appels IA' },
    ],
  },
  { href: '/clients', icon: Users, label: 'Clients' },
  { href: '/rapports', icon: LineChart, label: 'Rapports' },
];

const settingsNav: NavItem = {
  href: '/sync',
  icon: Settings,
  label: 'Paramètres',
  children: [
    { href: '/sync', label: 'Synchronisation ZRExpress' },
    { href: '/integrations', label: 'Intégrations' },
    { href: '/parametres/api-keys', label: 'Clés API' },
    { href: '/mon-compte', label: 'Mon compte' },
  ],
};

const matches = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + '/');

const isSectionActive = (pathname: string, item: NavItem) =>
  matches(pathname, item.href) || !!item.children?.some((c) => matches(pathname, c.href));

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface Me {
  role?: string | null;
  full_name?: string | null;
  email?: string | null;
  plan_id?: string | null;
}

const PLAN_LABEL: Record<string, string> = {
  basic: 'Basic',
  pro: 'Pro',
  business: 'Business',
};

function initialsOf(me: Me | null): string {
  const source = (me?.full_name || me?.email || '').trim();
  if (!source) return '·';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname() ?? '';
  const { toggle, isOpen } = useChatbot();
  const { theme, toggle: toggleTheme } = useTheme();

  // Rôle lu côté serveur (/api/auth/me) : le lien « Super Admin » n'apparaît
  // que pour le claim admin du jeton.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMe(j))
      .catch(() => {});
  }, []);

  const isMobile = mobileOpen !== undefined && onMobileClose !== undefined;
  const narrow = isMobile ? false : collapsed;
  const isAdmin = me?.role === 'admin';

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const open = isSectionActive(pathname, item);
    const exact = matches(pathname, item.href) && !item.children;
    return (
      <li key={item.label}>
        <Link
          href={item.href}
          onClick={onMobileClose}
          title={narrow ? item.label : undefined}
          className={`flex items-center gap-3 h-9 rounded-md text-[14px] transition-colors ${
            narrow ? 'justify-center px-0' : 'px-3'
          } ${
            open || exact
              ? 'bg-stone-900/[0.05] text-stone-900 font-medium dark:bg-white/[0.07] dark:text-stone-50'
              : 'text-stone-500 hover:bg-stone-900/[0.03] hover:text-stone-800 dark:text-stone-400 dark:hover:bg-white/[0.04] dark:hover:text-stone-100'
          }`}
        >
          <Icon size={17} strokeWidth={1.75} className="shrink-0" />
          {!narrow && <span className="truncate">{item.label}</span>}
        </Link>
        {open && !narrow && item.children && (
          <ul className="mt-0.5 mb-1.5 ml-[22px] pl-3 border-l border-stone-200 dark:border-stone-800 space-y-0.5">
            {item.children.map((c) => {
              const active =
                pathname === c.href || (c.href !== item.href && matches(pathname, c.href));
              return (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    onClick={onMobileClose}
                    className={`block px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                      active
                        ? 'text-stone-900 font-medium dark:text-stone-50'
                        : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100'
                    }`}
                  >
                    {c.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  const iconButton =
    'flex items-center justify-center w-8 h-8 rounded-md text-stone-500 hover:bg-stone-900/[0.04] hover:text-stone-800 dark:text-stone-400 dark:hover:bg-white/[0.06] dark:hover:text-stone-100 transition-colors';

  return (
    <aside
      // h-screen + flex-col : la nav (flex-1, min-h-0) scrolle en interne même
      // sur un petit écran ; le pied (Paramètres, compte) reste accessible.
      className={`relative flex flex-col h-screen bg-white dark:bg-stone-950 border-r border-stone-200/70 dark:border-stone-800 transition-[width] duration-300 ease-in-out shrink-0 ${
        narrow ? 'w-[64px]' : 'w-[232px]'
      }`}
    >
      <div className={`flex items-center h-[64px] ${narrow ? 'justify-center' : 'gap-2.5 px-6'}`}>
        <div className="w-7 h-7 rounded-md bg-stone-900 dark:bg-white flex items-center justify-center shrink-0">
          <span className="text-white dark:text-stone-900 font-semibold text-[13px]">A</span>
        </div>
        {!narrow && (
          <span className="font-semibold text-[15px] tracking-tight text-stone-900 dark:text-stone-50">
            AutoTim
          </span>
        )}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 pt-2">
        <ul className="space-y-0.5">{mainNav.map(renderItem)}</ul>
      </nav>

      <div className="px-3 pb-3 pt-2 space-y-0.5">
        <ul>{renderItem(settingsNav)}</ul>
        {isAdmin && <ul>{renderItem({ href: '/admin', icon: Shield, label: 'Super Admin' })}</ul>}

        <div
          className={`flex items-center gap-2.5 pt-3 mt-2 border-t border-stone-100 dark:border-stone-800 ${
            narrow ? 'flex-col' : 'px-1'
          }`}
        >
          <Link
            href="/mon-compte"
            onClick={onMobileClose}
            title={narrow ? 'Mon compte' : undefined}
            className={`flex items-center gap-2.5 min-w-0 ${narrow ? '' : 'flex-1'}`}
          >
            <div className="w-7 h-7 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 grid place-items-center text-[11px] font-semibold shrink-0">
              {initialsOf(me)}
            </div>
            {!narrow && (
              <div className="min-w-0 leading-tight">
                <div className="text-[13px] font-medium text-stone-900 dark:text-stone-100 truncate">
                  {me?.full_name || me?.email || 'Mon compte'}
                </div>
                <div className="text-[12px] text-stone-400 truncate">
                  {PLAN_LABEL[me?.plan_id ?? ''] ?? 'Basic'}
                </div>
              </div>
            )}
          </Link>
          <button
            onClick={toggleTheme}
            className={iconButton}
            title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          >
            {theme === 'dark' ? (
              <Sun size={16} strokeWidth={1.75} />
            ) : (
              <Moon size={16} strokeWidth={1.75} />
            )}
          </button>
          <button
            onClick={toggle}
            className={`${iconButton} ${isOpen ? 'bg-stone-900/[0.05] text-stone-900 dark:bg-white/[0.07] dark:text-stone-50' : ''}`}
            title="Assistant IA"
            aria-label="Assistant IA"
          >
            <Sparkles size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {!isMobile && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          className="hidden md:flex absolute -right-3 top-[20px] w-6 h-6 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-full items-center justify-center hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors z-10"
        >
          {collapsed ? (
            <ChevronRight size={12} className="text-stone-500" />
          ) : (
            <ChevronLeft size={12} className="text-stone-500" />
          )}
        </button>
      )}
    </aside>
  );
}
