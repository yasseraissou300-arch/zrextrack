import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://zrextrack6753.builtwithrocket.new';

// Statuts qui déclenchent une notification WhatsApp
const NOTIFY_STATUSES = new Set(['en_transit', 'en_livraison', 'livre', 'echec', 'retourne']);

const DEFAULT_TEMPLATES: Record<string, string> = {
  en_transit:   `📦 Bonjour {client},\n\nVotre commande *{tracking}* est maintenant *en transit* vers {wilaya}.\n\nSuivez-la ici : {lien}`,
  en_livraison: `🚚 Bonjour {client},\n\nVotre commande *{tracking}* est *en cours de livraison* aujourd'hui !\n\nSoyez disponible. Suivi : {lien}`,
  livre:        `✅ Bonjour {client},\n\nVotre commande *{tracking}* a été *livrée avec succès* ! 🎉\n\nMerci pour votre confiance. Suivi : {lien}`,
  echec:        `⚠️ Bonjour {client},\n\nNous n'avons pas pu livrer votre commande *{tracking}*.\n\nVeuillez contacter le vendeur ou suivre : {lien}`,
  retourne:     `📦 Bonjour {client},\n\nVotre commande *{tracking}* a été *retournée*.\n\nContactez le vendeur. Suivi : {lien}`,
};

// Construire le message à partir du template (custom ou défaut)
function buildMessage(
  status: string, client: string, tracking: string, wilaya: string,
  customTemplates?: Record<string, string>
): string {
  const link = `${APP_URL}/track/${tracking}`;
  const name = client || 'cher client';
  const tpl = (customTemplates?.[status] || DEFAULT_TEMPLATES[status] || `Mise à jour commande {tracking} : ${status}. Suivi : {lien}`);
  return tpl
    .replace(/{client}/g, name)
    .replace(/{tracking}/g, tracking)
    .replace(/{wilaya}/g, wilaya || 'votre wilaya')
    .replace(/{lien}/g, link);
}

// Normaliser numéro algérien → 213XXXXXXXXX
function normalizePhone(phone: string): string {
  const clean = phone.replace(/[\s\-\(\)\+\.]/g, '');
  if (clean.startsWith('213')) return clean;
  if (clean.startsWith('0')) return '213' + clean.slice(1);
  if (clean.length === 9) return '213' + clean;
  return clean;
}

// Envoyer un message WhatsApp via Meta Business API
async function sendWhatsApp(phoneNumberId: string, accessToken: string, phone: string, message: string): Promise<boolean> {
  try {
    const intlPhone = normalizePhone(phone);
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: intlPhone,
        type: 'text',
        text: { body: message },
      }),
    });
    const json = await res.json().catch(() => ({}));
    return !!json.messages?.[0]?.id;
  } catch {
    return false;
  }
}

// Normalise une chaîne ZREXpress : minuscules + sans accents + espaces normalisés
function norm(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // supprime les accents
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Map ZREXpress état + situation → statut interne
// RÈGLE : la situation est vérifiée EN PREMIER — elle prime toujours sur l'état
function mapStatus(rawState: string, rawSituation = ''): string {
  const s = norm(rawState);
  const sit = norm(rawSituation);
  const has = (src: string, ...terms: string[]) => terms.some(t => src.includes(t));

  // ══ PRIORITÉ 1 : SITUATION → ÉCHEC ═══════════════════════════════════════
  // Si la situation indique un problème, peu importe l'état (même "En préparation")
  if (sit && has(sit,
    // Pas de réponse
    'appele sans reponse', 'sans reponse', 'appele sr', 'ne repond pas',
    'repond pas', 'pas repondu', 'pas de reponse',
    // Absent / injoignable
    'client absent', 'absent', 'non joignable', 'injoignable',
    // Refus
    'refus de livraison', 'refuse',
    // Annulé
    'annule', 'annulee', 'annulation',
    // Echec livraison
    'echec', 'echoue', 'echec de livraison', 'non livre', 'non remis', 'colis non remis',
    // Adresse/commune erronée
    'commune erronee', 'adresse erronee', 'adresse incorrecte', 'errone', 'erronee',
    'commune incorrecte', 'wilaya erronee',
    // Téléphone invalide
    'telephone incorrect', 'numero incorrect', 'numero invalide',
    // Introuvable
    'introuvable', 'adresse introuvable', 'client introuvable',
    // En attente d'info
    'en attente adresse', 'attente adresse', 'attente confirmation',
    'en attente de confirmation'
  )) return 'echec';

  // ══ PRIORITÉ 2 : SITUATION → RETOURNÉ ════════════════════════════════════
  if (sit && has(sit,
    'retourne', 'retour expediteur', 'retour confirme',
    'refus client', 'renvoye', 'renvoi', 'retour marchand'
  )) return 'retourne';

  // ══ PRIORITÉ 3 : SITUATION → EN LIVRAISON ════════════════════════════════
  if (sit && has(sit,
    'sorti en livraison', 'sorti', 'en cours de livraison', 'en distribution',
    'distribution', 'reporte', 'reportee', 'en route vers client',
    // ZREXpress : appel au client pour livraison bureau ou domicile
    'appel telephonique', 'appel tel', 'appele',
    // En attente de retrait au bureau
    'en attente de retrait', 'attente de retrait', 'attente retrait',
    'en attente au bureau', 'disponible au bureau', 'au bureau',
    // Passage prévu
    'passage prevu', 'passage programme', 'livraison prevue',
    // Avisé (client notifié)
    'avise', 'avisee', 'client avise',
    // Livraison en cours générique
    'en livraison', 'livraison en cours', 'en cours'
  )) return 'en_livraison';

  // ══ PRIORITÉ 4 : SITUATION → EN TRANSIT ══════════════════════════════════
  if (sit && has(sit, 'en transit', 'transit', 'hub', 'centre tri', 'arrive au hub', 'expedie')) return 'en_transit';

  // ══ PRIORITÉ 5 : SITUATION → LIVRÉ ═══════════════════════════════════════
  if (sit && has(sit, 'livre', 'remis') && !has(sit, 'en cours', 'sorti', 'non remis')) return 'livre';

  // ══ À PARTIR D'ICI : lecture de l'ÉTAT (aucune situation significative) ══

  // ── ÉTAT → LIVRÉ ─────────────────────────────────────────────────────────
  if (s === 'livre' || s === 'livree' || s === 'delivered') return 'livre';
  if (has(s, 'livre') && !has(s, 'en livr', 'en cours', 'retour')) return 'livre';
  if (has(s, 'remis au client', 'remis destinataire', 'livraison effectuee')) return 'livre';

  // ── ÉTAT → ÉCHEC / ANNULÉ ────────────────────────────────────────────────
  if (has(s,
    'echec', 'echoue', 'annule', 'annulee', 'annulation',
    'cancel', 'canceled', 'errone', 'erronee', 'non delivre', 'non livre'
  )) return 'echec';

  // ── ÉTAT → RETOURNÉ ──────────────────────────────────────────────────────
  if (has(s, 'retourne', 'en retour', 'retour expediteur', 'retour confirme', 'return')) return 'retourne';

  // ── ÉTAT → EN TRANSIT ────────────────────────────────────────────────────
  if (has(s,
    'expedie', 'expedier', 'shipped', 'en transit', 'transit',
    'arrive au hub', 'arrivee hub', 'hub', 'centre tri', 'centre de tri',
    'en acheminement', 'acheminement'
  )) return 'en_transit';

  // ── ÉTAT → EN LIVRAISON ──────────────────────────────────────────────────
  if (has(s,
    'en livr', 'en cours de livr', 'sorti', 'en distribution',
    'distribution', 'on delivery', 'out for delivery'
  )) return 'en_livraison';

  // ── ÉTAT → EN PRÉPARATION ────────────────────────────────────────────────
  if (has(s,
    'en preparation', 'preparation', 'prise en charge', 'pec',
    'en attente', 'attente', 'nouveau', 'new', 'pending',
    'recu', 'enleve', 'collecte', 'ramassage'
  )) return 'en_preparation';

  return 'en_preparation';
}

// Fetch all pages from ZREXpress
async function fetchAllParcels(token: string, tenantId: string): Promise<any[]> {
  const all: any[] = [];
  let pageNumber = 1;
  const pageSize = 100;
  let totalPages = 1;

  while (pageNumber <= totalPages) {
    const res = await fetch(`${ZREXPRESS_API}/parcels/search`, {
      method: 'POST',
      headers: {
        'X-Api-Key': token,
        'X-Tenant': tenantId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pageNumber, pageSize }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ZREXpress API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();

    if (Array.isArray(data)) {
      all.push(...data);
      break;
    }

    const items = data.content || data.items || data.data || data.parcels || [];
    all.push(...items);

    totalPages = data.totalPages ?? data.total_pages ?? 1;
    pageNumber++;
    if (pageNumber > 50) break;
  }

  return all;
}

function mapParcel(p: any, syncedAt: string) {
  const tracking =
    p.trackingNumber || p.trackingCode || p.tracking_code || p.tracking || p.barcode || p.id || '';

  const client =
    p.customer?.name || p.recipientName || p.recipient_name || p.clientName || p.client_name || '';

  const phoneObj = (p.customer?.phone && typeof p.customer.phone === 'object') ? p.customer.phone : {};
  const whatsapp =
    phoneObj.number1 || phoneObj.number2 || phoneObj.number3 ||
    (typeof p.customer?.phone === 'string' ? p.customer.phone : '') ||
    p.recipientPhone || p.recipient_phone || p.phone || '';

  const wilaya =
    p.deliveryAddress?.city || p.wilaya?.name || p.wilayaName || p.wilaya_name || p.wilaya || p.city || '';

  const district =
    p.deliveryAddress?.district || p.deliveryAddress?.commune || p.district || '';

  const product =
    p.productsDescription || p.description ||
    (p.orderedProducts && p.orderedProducts.length > 0 ? p.orderedProducts[0].productName : '') ||
    p.productName || p.product_name || p.product?.name || '';

  const cod = p.amount ?? p.price ?? p.cod ?? p.codAmount ?? p.cod_amount ?? 0;

  const rawStatus =
    p.state?.name || p.stateName || p.status?.name || p.statusName || p.state || p.status || '';
  const situation =
    p.situation?.name || p.situationName || p.lastSituation?.name || p.lastSituationName || p.situation || '';
  // Passer aussi la situation pour une classification plus précise
  const status = mapStatus(rawStatus, situation);
  const delivery_type = p.deliveryType || p.delivery_type || p.type || '';
  const delivery_fees = p.deliveryPrice ?? p.delivery_price ?? p.deliveryFees ?? p.delivery_fees ?? p.fees ?? 0;
  const attempts = p.deliveryAttempts ?? p.delivery_attempts ?? p.attempts ?? 0;

  return {
    tracking_number: String(tracking),
    customer_name: String(client),
    customer_whatsapp: String(whatsapp),
    wilaya: String(wilaya),
    product_name: String(product),
    cod: Number(cod),
    delivery_status: status,
    attempts: Number(attempts),
    last_update: syncedAt,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { token, tenantId, templates: customTemplates, notifyEnabled } = await request.json();
    if (!token) return NextResponse.json({ error: 'Clé API (secretKey) manquante' }, { status: 400 });
    if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });

    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    const userId = user?.id ?? null;

    const supabase = createServiceClient();

    // Récupérer les credentials WhatsApp depuis whatsapp_settings (comme les autres routes)
    const { data: waSettings } = userId
      ? await supabase.from('whatsapp_settings').select('instance_id, api_token').eq('user_id', userId).single()
      : { data: null };
    const waInstanceId: string = waSettings?.instance_id ?? '';
    const waToken: string = waSettings?.api_token ?? '';

    // 1. Récupérer toutes les commandes depuis ZREXpress
    const parcels = await fetchAllParcels(token, tenantId);
    if (parcels.length === 0) {
      return NextResponse.json({ synced: 0, message: 'Aucune commande trouvée sur ZREXpress' });
    }

    const syncedAt = new Date().toISOString();

    const allRows = parcels
      .map(p => mapParcel(p, syncedAt))
      .filter(r => r.tracking_number)
      .map(r => ({ ...r, user_id: userId }));

    const seen = new Set<string>();
    const rows = allRows.filter(r => {
      if (seen.has(r.tracking_number)) return false;
      seen.add(r.tracking_number);
      return true;
    });

    const trackingNums = rows.map(r => r.tracking_number);

    // 2. Charger les statuts actuels pour détecter les changements
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('tracking_number, delivery_status, customer_whatsapp, customer_name, wilaya')
      .in('tracking_number', trackingNums);

    const existingMap = new Map((existingOrders || []).map(o => [o.tracking_number, o]));

    // 3. Identifier les commandes dont le statut a changé
    const toNotify: Array<{ tracking_number: string; delivery_status: string; customer_whatsapp: string; customer_name: string; wilaya: string }> = [];
    for (const row of rows) {
      const existing = existingMap.get(row.tracking_number);
      // Vérifier si les notifications sont activées pour ce statut (true par défaut si non précisé)
      const isEnabled = notifyEnabled ? (notifyEnabled[row.delivery_status] !== false) : true;
      if (
        NOTIFY_STATUSES.has(row.delivery_status) &&
        isEnabled &&
        row.customer_whatsapp &&
        row.customer_whatsapp.length > 4 &&
        existing?.delivery_status !== row.delivery_status
      ) {
        toNotify.push({
          tracking_number: row.tracking_number,
          delivery_status: row.delivery_status,
          customer_whatsapp: row.customer_whatsapp,
          customer_name: row.customer_name,
          wilaya: row.wilaya,
        });
      }
    }

    // 4. Upsert les commandes
    const { error, count } = await supabase
      .from('orders')
      .upsert(rows, { onConflict: 'tracking_number', count: 'exact' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 5. Envoyer les notifications WhatsApp + logger dans messages
    let whatsappSent = 0;
    for (const n of toNotify) {
      const message = buildMessage(n.delivery_status, n.customer_name, n.tracking_number, n.wilaya, customTemplates);
      const sent = waInstanceId && waToken
        ? await sendWhatsApp(waInstanceId, waToken, n.customer_whatsapp, message)
        : false;
      if (sent) whatsappSent++;

      // Logger dans la table messages
      await supabase.from('messages').insert({
        tracking_number: n.tracking_number,
        customer_name: n.customer_name,
        customer_whatsapp: n.customer_whatsapp,
        message,
        status: sent ? 'envoye' : 'echec',
        sent_at: syncedAt,
        user_id: userId,
      }).select();
    }

    return NextResponse.json({
      synced: count ?? rows.length,
      total: parcels.length,
      whatsapp_sent: whatsappSent,
      notifications: toNotify.length,
      message: `${rows.length} commandes synchronisées · ${whatsappSent} notifications WhatsApp envoyées`,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
