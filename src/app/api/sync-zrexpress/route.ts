import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://zrextrack6753.builtwithrocket.new';

// Statuts qui déclenchent une notification WhatsApp
const NOTIFY_STATUSES = new Set(['en_transit', 'en_livraison', 'livre', 'echec', 'retourne']);

// Messages WhatsApp par statut
function buildMessage(status: string, client: string, tracking: string, wilaya: string): string {
  const link = `${APP_URL}/track/${tracking}`;
  const name = client || 'cher client';
  switch (status) {
    case 'en_transit':
      return `📦 Bonjour ${name},\n\nVotre commande *${tracking}* est maintenant *en transit* vers ${wilaya || 'votre wilaya'}.\n\nSuivez-la ici : ${link}`;
    case 'en_livraison':
      return `🚚 Bonjour ${name},\n\nVotre commande *${tracking}* est *en cours de livraison* aujourd'hui !\n\nSoyez disponible. Suivi : ${link}`;
    case 'livre':
      return `✅ Bonjour ${name},\n\nVotre commande *${tracking}* a été *livrée avec succès* ! 🎉\n\nMerci pour votre confiance. Suivi : ${link}`;
    case 'echec':
      return `⚠️ Bonjour ${name},\n\nNous n'avons pas pu livrer votre commande *${tracking}*.\n\nVeuillez contacter le vendeur ou suivre : ${link}`;
    case 'retourne':
      return `📦 Bonjour ${name},\n\nVotre commande *${tracking}* a été *retournée*.\n\nContactez le vendeur. Suivi : ${link}`;
    default:
      return `📦 Bonjour ${name}, mise à jour de votre commande ${tracking} : ${status}. Suivi : ${link}`;
  }
}

// Normaliser numéro algérien → 213XXXXXXXXX
function normalizePhone(phone: string): string {
  const clean = phone.replace(/[\s\-\(\)\+\.]/g, '');
  if (clean.startsWith('213')) return clean;
  if (clean.startsWith('0')) return '213' + clean.slice(1);
  if (clean.length === 9) return '213' + clean;
  return clean;
}

// Envoyer un message WhatsApp via Green API
async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const token = process.env.GREEN_API_TOKEN;
  if (!instanceId || !token) return false;

  try {
    const intlPhone = normalizePhone(phone);
    const host = process.env.GREEN_API_HOST || '7107';
    const res = await fetch(
      `https://${host}.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: `${intlPhone}@c.us`, message }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Map ZREXpress parcel status → our internal status
function mapStatus(state: string): string {
  const s = (state || '').toLowerCase().replace(/\s+/g, '_');
  if (s.includes('livr') && !s.includes('en_')) return 'livre';
  if (s.includes('en_pr') || s.includes('preparation')) return 'en_preparation';
  if (s.includes('transit')) return 'en_transit';
  if (s.includes('en_livr') || s.includes('sorti') || s.includes('distribution')) return 'en_livraison';
  if (s.includes('retour')) return 'retourne';
  if (s.includes('chec') || s.includes('annul') || s.includes('echec')) return 'echec';
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
  const status = mapStatus(rawStatus);
  const situation = p.situation?.name || p.situationName || p.situation || '';
  const delivery_type = p.deliveryType || p.delivery_type || p.type || '';
  const delivery_fees = p.deliveryPrice ?? p.delivery_price ?? p.deliveryFees ?? p.delivery_fees ?? p.fees ?? 0;
  const attempts = p.deliveryAttempts ?? p.delivery_attempts ?? p.attempts ?? 0;

  return {
    tracking: String(tracking),
    client: String(client),
    whatsapp: String(whatsapp),
    wilaya: String(wilaya),
    district: String(district),
    product: String(product),
    cod: Number(cod),
    status,
    situation: String(situation),
    delivery_type: String(delivery_type),
    delivery_fees: Number(delivery_fees),
    attempts: Number(attempts),
    created_at: p.createdAt || p.created_at || syncedAt,
    last_update: syncedAt,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { token, tenantId } = await request.json();
    if (!token) return NextResponse.json({ error: 'Clé API (secretKey) manquante' }, { status: 400 });
    if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });

    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    const userId = user?.id ?? null;

    const supabase = createServiceClient();

    // 1. Récupérer toutes les commandes depuis ZREXpress
    const parcels = await fetchAllParcels(token, tenantId);
    if (parcels.length === 0) {
      return NextResponse.json({ synced: 0, message: 'Aucune commande trouvée sur ZREXpress' });
    }

    const syncedAt = new Date().toISOString();

    const allRows = parcels
      .map(p => mapParcel(p, syncedAt))
      .filter(r => r.tracking)
      .map(r => ({ ...r, user_id: userId }));

    const seen = new Set<string>();
    const rows = allRows.filter(r => {
      if (seen.has(r.tracking)) return false;
      seen.add(r.tracking);
      return true;
    });

    const trackingNums = rows.map(r => r.tracking);

    // 2. Charger les statuts actuels pour détecter les changements
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('tracking, status, whatsapp, client, wilaya')
      .in('tracking', trackingNums);

    const existingMap = new Map((existingOrders || []).map(o => [o.tracking, o]));

    // 3. Identifier les commandes dont le statut a changé
    const toNotify: Array<{ tracking: string; status: string; whatsapp: string; client: string; wilaya: string }> = [];
    for (const row of rows) {
      const existing = existingMap.get(row.tracking);
      if (
        NOTIFY_STATUSES.has(row.status) &&
        row.whatsapp &&
        row.whatsapp.length > 4 &&
        existing?.status !== row.status
      ) {
        toNotify.push({
          tracking: row.tracking,
          status: row.status,
          whatsapp: row.whatsapp,
          client: row.client,
          wilaya: row.wilaya,
        });
      }
    }

    // 4. Upsert les commandes
    const { error, count } = await supabase
      .from('orders')
      .upsert(rows, { onConflict: 'tracking', count: 'exact' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 5. Envoyer les notifications WhatsApp + logger dans messages
    let whatsappSent = 0;
    for (const n of toNotify) {
      const message = buildMessage(n.status, n.client, n.tracking, n.wilaya);
      const sent = await sendWhatsApp(n.whatsapp, message);
      if (sent) whatsappSent++;

      // Logger dans la table messages
      await supabase.from('messages').insert({
        tracking: n.tracking,
        client: n.client,
        whatsapp: n.whatsapp,
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
