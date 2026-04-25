import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

function norm(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// PRIORITÉ : situation vérifiée EN PREMIER
function mapStatus(rawState: string, rawSituation = ''): string {
  const s = norm(rawState);
  const sit = norm(rawSituation);
  const has = (src: string, ...terms: string[]) => terms.some(t => src.includes(t));

  if (sit && has(sit,
    'appele sans reponse', 'sans reponse', 'appele sr', 'ne repond pas',
    'repond pas', 'pas repondu', 'pas de reponse',
    'client absent', 'absent', 'non joignable', 'injoignable',
    'refus de livraison', 'refuse',
    'annule', 'annulee', 'annulation',
    'echec', 'echoue', 'echec de livraison', 'non livre', 'non remis', 'colis non remis',
    'commune erronee', 'adresse erronee', 'adresse incorrecte', 'errone', 'erronee',
    'commune incorrecte', 'wilaya erronee',
    'telephone incorrect', 'numero incorrect', 'numero invalide',
    'introuvable', 'adresse introuvable', 'client introuvable',
    'en attente adresse', 'attente adresse', 'attente confirmation'
  )) return 'echec';

  if (sit && has(sit, 'retourne', 'retour expediteur', 'retour confirme', 'refus client', 'renvoye', 'retour marchand')) return 'retourne';
  if (sit && has(sit, 'sorti en livraison', 'sorti', 'en cours de livraison', 'distribution', 'reporte')) return 'en_livraison';
  if (sit && has(sit, 'en transit', 'transit', 'hub', 'centre tri', 'expedie')) return 'en_transit';
  if (sit && has(sit, 'livre', 'remis') && !has(sit, 'non remis', 'en cours', 'sorti')) return 'livre';

  if (s === 'livre' || s === 'livree' || s === 'delivered') return 'livre';
  if (has(s, 'livre') && !has(s, 'en livr', 'en cours', 'retour')) return 'livre';
  if (has(s, 'echec', 'echoue', 'annule', 'annulee', 'annulation', 'cancel', 'errone', 'non delivre')) return 'echec';
  if (has(s, 'retourne', 'en retour', 'retour expediteur', 'return')) return 'retourne';
  if (has(s, 'expedie', 'shipped', 'en transit', 'transit', 'hub', 'centre tri', 'acheminement')) return 'en_transit';
  if (has(s, 'en livr', 'en cours de livr', 'sorti', 'distribution', 'out for delivery')) return 'en_livraison';
  if (has(s, 'en preparation', 'preparation', 'prise en charge', 'pec', 'en attente', 'nouveau', 'pending', 'recu', 'enleve', 'collecte')) return 'en_preparation';

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

  // Re-classifier chaque commande uniquement à partir de la SITUATION stockée.
  // Le champ status en base est déjà le statut interne mappé ('en_preparation', etc.),
  // pas le nom ZREXpress original — on passe '' comme état pour forcer la lecture de la situation.
  const updates: { id: string; status: string }[] = [];
  for (const order of orders) {
    const sit = order.situation ?? '';
    if (!sit.trim()) continue; // pas de situation → on ne peut pas reclassifier
    const newStatus = mapStatus('', sit);
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
