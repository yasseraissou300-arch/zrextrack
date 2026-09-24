import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { mapStatus } from '@/lib/zrexpress/status';

// Re-classification des commandes à partir de la SITUATION stockée.
//
// Deux défauts corrigés :
// 1. Cette route avait sa PROPRE copie de mapStatus, qui avait divergé de
//    celle du sync (src/lib/zrexpress/status) : « en attente de confirmation »,
//    « renvoi », etc. n'y figuraient pas. Re-classifier pouvait donc écrire un
//    statut que le sync suivant écrasait. Désormais : la fonction partagée.
// 2. Lecture sans pagination : PostgREST plafonne à 1 000 lignes → au-delà,
//    les commandes n'étaient jamais re-classifiées (5 022 actives pour le
//    tenant pilote).

const PAGE = 1000;
const MAX_ROWS = 50_000;

export async function POST() {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();

  const orders: Array<{ id: string; delivery_status: string; situation: string | null }> = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, delivery_status, situation')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: 'Lecture impossible' }, { status: 500 });
    orders.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  if (orders.length === 0) return NextResponse.json({ updated: 0 });

  // Le delivery_status stocké est déjà le statut interne : on passe '' comme
  // état pour forcer la lecture de la situation.
  const updates: { id: string; delivery_status: string }[] = [];
  for (const order of orders) {
    const sit = order.situation ?? '';
    if (!sit.trim()) continue; // pas de situation → rien à re-classifier
    const newStatus = mapStatus('', sit);
    if (newStatus !== order.delivery_status) {
      updates.push({ id: order.id, delivery_status: newStatus });
    }
  }

  let updated = 0;
  for (const upd of updates) {
    const { error } = await supabase
      .from('orders')
      .update({ delivery_status: upd.delivery_status })
      .eq('id', upd.id)
      .eq('user_id', user.id);
    if (!error) updated++; // compteur fidèle : seules les écritures réussies
  }

  return NextResponse.json({
    total: orders.length,
    updated,
    message: `${updated} commande(s) re-classifiée(s) sur ${orders.length}`,
  });
}
