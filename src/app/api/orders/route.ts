import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/security/safe-log';

const MAX_PAGE_SIZE = 100; // plus grande valeur proposée par l'interface
const MAX_PAGE = 10_000;
const MAX_SEARCH_LENGTH = 100;

/** Entier borné ; valeur absente ou invalide → défaut. */
function boundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Valeur littérale pour un filtre `.or()` PostgREST : entre guillemets doubles,
 * `\` et `"` échappés. Sans cela, une virgule, un point ou une parenthèse dans
 * la recherche (« Benali, Amine », « (Oran) ») cassait la requête (500), et la
 * saisie était interprétée comme syntaxe de filtre.
 * Les jokers % et _ restent actifs : la recherche reste « contient », toujours
 * limitée aux commandes du marchand (user_id appliqué à part, combiné par ET).
 */
function orValue(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Map situation filter values to status column codes (for delivery-stage filters)
const SITUATION_TO_STATUS: Record<string, string> = {
  'en cours de livraison': 'en_livraison',
  livr: 'livre',
  retour: 'retourne',
  'en transit': 'en_transit',
  'en preparation': 'en_preparation',
};

export async function GET(request: NextRequest) {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    // page / pageSize bornés : `page=0`, `abc` ou un pageSize énorme
    // produisaient une plage invalide → 500.
    const page = boundedInt(searchParams.get('page'), 1, 1, MAX_PAGE);
    const pageSize = boundedInt(searchParams.get('pageSize'), 10, 1, MAX_PAGE_SIZE);
    const status = searchParams.get('status') || 'all';
    const situation = searchParams.get('situation') || '';
    const search = (searchParams.get('search') || '').trim().slice(0, MAX_SEARCH_LENGTH);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const supabase = createServiceClient();
    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .is('deleted_at', null);

    // « en_cours » = tout ce qui n'est pas encore finalisé (onglet En cours).
    if (status === 'en_cours') {
      query = query.in('delivery_status', ['en_preparation', 'en_transit', 'en_livraison']);
    } else if (status !== 'all') {
      query = query.eq('delivery_status', status);
    }

    if (situation) {
      // Check if this filter maps to a status code (delivery stage filters)
      const statusCode = SITUATION_TO_STATUS[situation.toLowerCase()];
      if (statusCode) {
        query = query.eq('delivery_status', statusCode);
      } else {
        // Situation-based filter (Commande annulee, Ne repond pas, Commune erronee, etc.)
        query = query.ilike('situation', `%${situation}%`);
      }
    }

    if (search) {
      const v = orValue(`%${search}%`);
      query = query.or(`tracking_number.ilike.${v},customer_name.ilike.${v}`);
    }
    // Tri STABLE : beaucoup de commandes partagent le même last_update (le sync
    // l'écrivait sur toutes les lignes). Sans départage, PostgreSQL peut rendre
    // ces lignes dans un ordre différent à chaque page → doublons et commandes
    // jamais affichées en naviguant. `id` départage.
    query = query
      .order('last_update', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    const { data, count, error } = await query;
    if (error) {
      // Jamais l'erreur PostgREST brute au navigateur (texte du filtre, table).
      logEvent('error', 'api.orders', { status: 'read_failed', error_code: error.code });
      return NextResponse.json({ error: 'Erreur de lecture des commandes' }, { status: 500 });
    }
    return NextResponse.json({ data: data || [], count: count || 0 });
  } catch {
    logEvent('error', 'api.orders', { status: 'unexpected' });
    return NextResponse.json({ error: 'Erreur de lecture des commandes' }, { status: 500 });
  }
}
