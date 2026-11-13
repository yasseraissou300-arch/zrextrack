'use client';

// Profil de l'utilisateur connecté (/api/auth/me), lu UNE fois par chargement
// de page et partagé entre la barre latérale, la garde « employé » et la
// bannière d'invitation (sinon trois appels identiques à chaque page).

import { useEffect, useState } from 'react';

export interface Me {
  userId?: string;
  email?: string | null;
  role?: string | null;
  full_name?: string | null;
  plan_id?: string | null;
  workspace_role?: 'owner' | 'employe';
  workspace_name?: string | null;
}

let pending: Promise<Me | null> | null = null;

export function loadMe(): Promise<Me | null> {
  pending ??= fetch('/api/auth/me')
    .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
    .catch(() => null);
  return pending;
}

export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let alive = true;
    loadMe().then((m) => alive && setMe(m));
    return () => {
      alive = false;
    };
  }, []);
  return me;
}

/** Pages ouvertes à un employé. Le reste (réglages, WhatsApp, corbeille…) est au propriétaire. */
export const EMPLOYEE_PATHS = [
  '/admin-dashboard',
  '/commandes',
  '/livraisons',
  '/alertes',
  '/autoswap',
  '/clients',
  '/rapports',
  '/mon-compte',
];

export function employeeCanOpen(pathname: string): boolean {
  return EMPLOYEE_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
