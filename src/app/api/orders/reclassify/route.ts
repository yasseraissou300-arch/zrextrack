import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Identique à la fonction dans sync-zrexpress — re-classifie les commandes déjà en base
function norm(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapStatus(rawState: string, rawSituation = ''): string {
  const s = norm(rawState);
  const sit = norm(rawSituation);
  const has = (src: string, ...terms: string[]) => terms.some(t => src.includes(t));

  if (s === 'livre' || s === 'livree' || s === 'delivered') return 'livre';
  if (has(s, 'livre') && !has(s, 'en livr', 'en cours', 'retour')) return 'livre';
  if (has(s, 'remis au client', 'remis destinataire')) return 'livre';

  if (has(s, 'expedie', 'shipped', 'en transit', 'transit', 'hub', 'centre tri', 'acheminement')) return 'en_transit';
  if (has(sit, 'en transit', 'transit', 'hub', 'centre tri', 'arrive', 'expedie')) return 'en_transit';

  if (has(s, 'en livr', 'en cours de livr', 'sorti', 'distribution', 'out for delivery')) return 'en_livraison';
  if (has(sit, 'sorti', 'en cours de livr', 'distribution', 'reporte')) return 'en_livraison';

  if (has(s, 'en preparation', 'preparation', 'prise en charge', 'pec', 'en attente', 'nouveau', 'pending', 'recu', 'enleve', 'collecte')) return 'en_preparation';

  if (has(s, 'retourne', 'en retour', 'retour expediteur', 'return')) return 'retourne';
  if (has(sit, 'retourne', 'retour', 'refus client', 'refus livraison')) return 'retourne';

  if (has(s, 'echec', 'echoue', 'annule', 'annulee', 'cancel', 'errone', 'non delivre')) return 'echec';
  if (has(sit,
    'appele sans reponse', 'sans reponse', 'client absent', 'absent',
    'refus', 'echec', 'echoue', 'annule', 'annulee',
    'commune erronee', 'adresse erronee', 'adresse incorrecte', 'errone',
    'non remis', 'non joignable', 'injoignable', 'telephone incorrect',
    'introuvable', 'en attente adresse'
  )) return 'echec';

  if (has(sit, 'livre') && !has(sit, 'en cours', 'sorti')) return 'livre';
  if (has(sit, 'sorti', 'distribution', 'en livr')) return 'en_livraison';
  if (has(sit, 'transit', 'hub')) return 'en_transit';
  if (has(sit, 'retour')) return 'retourne';

  return 'en_preparation';
}

// POST /api/orders/reclassify
// Re-calcule le status de toutes les commandes existantes à partir de (situation + status actuel)
export async function POST() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();

  // Charger toutes les commandes avec leur situation stockée
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, status, situation')
    .eq('user_id', user.id)
    .is('deleted_at', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!orders || orders.length === 0) return NextResponse.json({ updated: 0 });

  // Re-classifier chaque commande
  // On utilise le status actuel comme "état" (il contient le label ZREXpress dans certains cas)
  // et la situation comme sous-état
  const updates: { id: string; status: string }[] = [];
  for (const order of orders) {
    const newStatus = mapStatus(order.status ?? '', order.situation ?? '');
    if (newStatus !== order.status) {
      updates.push({ id: order.id, status: newStatus });
    }
  }

  // Appliquer les corrections en batch
  let updated = 0;
  for (const upd of updates) {
    await supabase
      .from('orders')
      .update({ status: upd.status })
      .eq('id', upd.id)
      .eq('user_id', user.id);
    updated++;
  }

  return NextResponse.json({
    total: orders.length,
    updated,
    message: `${updated} commande(s) re-classifiée(s) sur ${orders.length}`,
  });
}
