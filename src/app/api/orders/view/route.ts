// Lecture des commandes pour les pages Alertes, Clients, Livraisons, Rapports.
//
// POURQUOI CETTE ROUTE : ces pages interrogeaient `orders` directement depuis
// le navigateur (clé anon + session). Les policies RLS de `orders` sont en
// récursion infinie (42P17, voir db/proposed/004_rls_fix_42P17.sql) : chaque
// requête renvoyait HTTP 500 et les pages restaient vides.
//
// Comme les ~50 autres routes de l'application, on passe par service_role avec
// un scoping applicatif STRICT sur l'utilisateur de la session. Le correctif
// RLS reste une décision séparée (migration 004, non exécutée).
//
// Vues FIXES (pas de colonnes ni de filtres libres venant du client) :
//   alertes     → échecs / retours, 50 plus récents
//   livraisons  → en_livraison, livre, echec, retourne
//   clients     → colonnes client pour le regroupement par client
//   rapports    → colonnes de statistiques

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

type View = {
  columns: string;
  statuses?: string[];
  orderBy: 'last_update' | 'created_at';
  limit?: number;
};

const ORDER_VIEWS: Record<string, View> = {
  alertes: { columns: '*', statuses: ['echec', 'retourne'], orderBy: 'last_update', limit: 50 },
  livraisons: {
    columns: '*',
    statuses: ['en_livraison', 'livre', 'echec', 'retourne'],
    orderBy: 'last_update',
  },
  clients: {
    columns: 'customer_name, customer_whatsapp, wilaya, delivery_status',
    orderBy: 'created_at',
  },
  rapports: { columns: 'delivery_status, wilaya, cod', orderBy: 'created_at' },
};

// PostgREST plafonne chaque réponse à 1 000 lignes : on pagine, sinon les
// comptes au-delà de 1 000 commandes auraient des statistiques silencieusement
// tronquées. Plafond global de sécurité.
const PAGE = 1000;
const MAX_ROWS = 50_000;

export async function GET(request: NextRequest) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const viewName = new URL(request.url).searchParams.get('view') || '';
  const view = ORDER_VIEWS[viewName];
  if (!view) return NextResponse.json({ error: 'Vue inconnue' }, { status: 400 });

  const supabase = createServiceClient();
  const cap = Math.min(view.limit ?? MAX_ROWS, MAX_ROWS);
  const rows: unknown[] = [];

  for (let from = 0; from < cap; from += PAGE) {
    let q = supabase
      .from('orders')
      .select(view.columns)
      .eq('user_id', user.id)
      .is('deleted_at', null);
    if (view.statuses) q = q.in('delivery_status', view.statuses);
    const to = Math.min(from + PAGE, cap) - 1;
    const { data, error } = await q
      .order(view.orderBy, { ascending: false })
      .order('id', { ascending: true }) // départage stable entre les pages
      .range(from, to);
    if (error) return NextResponse.json({ error: 'Lecture impossible' }, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < to - from + 1) break;
  }

  return NextResponse.json({ data: rows });
}
