import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { mapStatus } from '@/lib/zrexpress/status';

const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://zrextrack6753.builtwithrocket.new';

// Statuts qui déclenchent une notification WhatsApp
const NOTIFY_STATUSES = new Set(['en_transit', 'en_livraison', 'livre', 'echec', 'retourne']);

// Templates par défaut (darija) — utilisés si l'utilisateur n'a pas encore
// personnalisé ses messages. SOURCE UNIQUE : la table message_templates,
// éditée dans Messages → Templates. Même syntaxe à double accolade {{...}}
// que l'envoi manuel.
const DARIJA_DEFAULTS: Record<string, string> = {
  en_transit:   `السلام عليكم {{client}} 👋\nطردك *{{produit}}* رقم *{{tracking}}* في الطريق لـ *{{wilaya}}*.\nتبّع هنا : {{lien}} 🚚`,
  en_livraison: `السلام عليكم {{client}} 👋\nطردك *{{produit}}* رقم *{{tracking}}* مع الليفرور دروك في *{{wilaya}}*.\nالمبلغ لي يتسلم : *{{cod}} دج*. كون فالدار 🛵`,
  livre:        `السلام عليكم {{client}} 👋\nطردك *{{produit}}* رقم *{{tracking}}* وصل.\nشكرا على ثقتك فينا 🙏`,
  echec:        `السلام عليكم {{client}} 👋\nحاولنا نوصلو طردك *{{tracking}}* ولقيناك ما جاوبتناش.\nتواصل معنا : {{lien}} 📞`,
  retourne:     `السلام عليكم {{client}} 👋\nطردك رقم *{{tracking}}* رجع لينا.\nإذا تبغي تعاود تطلب تواصل معنا 🔄`,
};

// Construit le message d'un statut à partir du template UNIFIÉ de l'utilisateur
// (table message_templates, version darija) ou du défaut. Substitue les
// variables {{client}} {{tracking}} {{wilaya}} {{produit}} {{cod}} {{lien}}.
function buildMessage(
  status: string,
  o: { customer_name: string; tracking_number: string; wilaya: string; product_name: string; cod: number },
  userTemplates: Map<string, string>,
): string {
  const link = `${APP_URL}/track/${o.tracking_number}`;
  const tpl = userTemplates.get(status) || DARIJA_DEFAULTS[status] || `Mise à jour {{tracking}} : {{lien}}`;
  return tpl
    .replace(/\{\{client\}\}/g, o.customer_name || 'cher client')
    .replace(/\{\{tracking\}\}/g, o.tracking_number || '')
    .replace(/\{\{wilaya\}\}/g, o.wilaya || 'votre wilaya')
    .replace(/\{\{produit\}\}/g, o.product_name || '')
    .replace(/\{\{cod\}\}/g, String(o.cod ?? ''))
    .replace(/\{\{lien\}\}/g, link);
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

// La classification ZRExpress état+situation → statut interne vit désormais
// dans @/lib/zrexpress/status (partagée avec /api/autoswap/swapped-stats).
// mapStatus est importée en haut du fichier.

// Fetch all pages from ZREXpress
export async function fetchAllParcels(token: string, tenantId: string): Promise<any[]> {
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
    const { token, tenantId, notifyEnabled } = await request.json();
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

    // Templates UNIFIÉS : table message_templates (éditée dans Messages →
    // Templates). Source unique pour l'envoi auto ET manuel ; on prend la
    // version darija. Si l'utilisateur n'a rien personnalisé → DARIJA_DEFAULTS.
    const { data: tplRows } = userId
      ? await supabase.from('message_templates').select('key, content_darija').eq('user_id', userId)
      : { data: null };
    const userTpl = new Map<string, string>(
      (tplRows || [])
        .filter((t: { content_darija?: string | null }) => !!t.content_darija)
        .map((t: { key: string; content_darija: string }) => [t.key, t.content_darija])
    );

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
    // Scopé par user_id : on ne regarde que les commandes de l'utilisateur courant
    // pour éviter de cross-contaminer les notifications entre comptes.
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('tracking_number, delivery_status, customer_whatsapp, customer_name, wilaya')
      .eq('user_id', userId)
      .in('tracking_number', trackingNums);

    const existingMap = new Map((existingOrders || []).map(o => [o.tracking_number, o]));

    // 3. Identifier les commandes dont le statut a changé
    const toNotify: Array<{ tracking_number: string; delivery_status: string; customer_whatsapp: string; customer_name: string; wilaya: string; product_name: string; cod: number }> = [];
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
          product_name: row.product_name,
          cod: row.cod,
        });
      }
    }

    // 4. Upsert les commandes — onConflict composite (user_id, tracking_number)
    // pour garantir qu'un sync ne touche jamais les lignes d'un autre user
    // même s'ils partagent un même tracking ZRExpress.
    const { error, count } = await supabase
      .from('orders')
      .upsert(rows, { onConflict: 'user_id,tracking_number', count: 'exact' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 5. Envoyer les notifications WhatsApp + logger dans messages
    let whatsappSent = 0;
    for (const n of toNotify) {
      const message = buildMessage(n.delivery_status, n, userTpl);
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
