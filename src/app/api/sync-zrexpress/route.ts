import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { mapStatus } from '@/lib/zrexpress/status';
import { fetchAllParcels } from '@/lib/zrexpress/parcels';
import { drainNotifications } from '@/lib/whatsapp/drain-notifications';
import { countOrdersThisMonth, quotaStateFor } from '@/lib/plan-quotas';
import { stateUpdatedAt } from '@/lib/zrexpress/map-parcel';

// Statuts qui déclenchent une notification WhatsApp
const NOTIFY_STATUSES = new Set(['en_transit', 'en_livraison', 'livre', 'echec', 'retourne']);

// Normaliser numéro algérien → 213XXXXXXXXX
function normalizePhone(phone: string): string {
  const clean = phone.replace(/[\s\-()+.]/g, '');
  if (clean.startsWith('213')) return clean;
  if (clean.startsWith('0')) return '213' + clean.slice(1);
  if (clean.length === 9) return '213' + clean;
  return clean;
}

// Envoyer un message WhatsApp via Meta Business API
async function sendWhatsApp(
  phoneNumberId: string,
  accessToken: string,
  phone: string,
  message: string
): Promise<boolean> {
  try {
    const intlPhone = normalizePhone(phone);
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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

function mapParcel(p: any, syncedAt: string) {
  const tracking =
    p.trackingNumber || p.trackingCode || p.tracking_code || p.tracking || p.barcode || p.id || '';

  const client =
    p.customer?.name || p.recipientName || p.recipient_name || p.clientName || p.client_name || '';

  const phoneObj =
    p.customer?.phone && typeof p.customer.phone === 'object' ? p.customer.phone : {};
  const whatsapp =
    phoneObj.number1 ||
    phoneObj.number2 ||
    phoneObj.number3 ||
    (typeof p.customer?.phone === 'string' ? p.customer.phone : '') ||
    p.recipientPhone ||
    p.recipient_phone ||
    p.phone ||
    '';

  const wilaya =
    p.deliveryAddress?.city ||
    p.wilaya?.name ||
    p.wilayaName ||
    p.wilaya_name ||
    p.wilaya ||
    p.city ||
    '';

  const district = p.deliveryAddress?.district || p.deliveryAddress?.commune || p.district || '';

  const product =
    p.productsDescription ||
    p.description ||
    (p.orderedProducts && p.orderedProducts.length > 0 ? p.orderedProducts[0].productName : '') ||
    p.productName ||
    p.product_name ||
    p.product?.name ||
    '';

  const cod = p.amount ?? p.price ?? p.cod ?? p.codAmount ?? p.cod_amount ?? 0;

  const rawStatus =
    p.state?.name || p.stateName || p.status?.name || p.statusName || p.state || p.status || '';
  const situation =
    p.situation?.name ||
    p.situationName ||
    p.lastSituation?.name ||
    p.lastSituationName ||
    p.situation ||
    '';
  // Passer aussi la situation pour une classification plus précise
  const status = mapStatus(rawStatus, situation);
  const delivery_type = p.deliveryType || p.delivery_type || p.type || '';
  const delivery_fees =
    p.deliveryPrice ?? p.delivery_price ?? p.deliveryFees ?? p.delivery_fees ?? p.fees ?? 0;
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
    last_update: stateUpdatedAt(p, syncedAt),
  };
}

export async function POST(request: NextRequest) {
  try {
    const { token, tenantId, notifyEnabled } = await request.json();
    if (!token)
      return NextResponse.json({ error: 'Clé API (secretKey) manquante' }, { status: 400 });
    if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });

    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    const userId = user?.id ?? null;

    const supabase = createServiceClient();

    // Récupérer les credentials WhatsApp depuis whatsapp_settings (comme les autres routes)
    const { data: waSettings } = userId
      ? await supabase
          .from('whatsapp_settings')
          .select('instance_id, api_token')
          .eq('user_id', userId)
          .single()
      : { data: null };
    const waInstanceId: string = waSettings?.instance_id ?? '';
    const waToken: string = waSettings?.api_token ?? '';

    // Templates UNIFIÉS : table message_templates (éditée dans Messages →
    // Templates). Source unique pour l'envoi auto ET manuel ; on prend la
    // version darija. Si l'utilisateur n'a rien personnalisé → DARIJA_DEFAULTS
    // (src/lib/whatsapp/message-builder.ts).
    const { data: tplRows } = userId
      ? await supabase.from('message_templates').select('key, content_darija').eq('user_id', userId)
      : { data: null };
    const userTpl = new Map<string, string>(
      (tplRows || [])
        .filter((t: { content_darija?: string | null }) => !!t.content_darija)
        .map((t: { key: string; content_darija: string }) => [t.key, t.content_darija])
    );

    // ── Enforcement quota mensuel (Basic 200, Pro 2000, Business ∞) ──
    // On lit plan + usage courant, et on refuse tôt si l'user est déjà au-delà.
    // La sync ne fait alors PAS d'appel ZRExpress → pas de gaspillage réseau.
    let quotaState: ReturnType<typeof quotaStateFor> | null = null;
    if (userId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('plan_id, role')
        .eq('id', userId)
        .maybeSingle();
      const used = await countOrdersThisMonth(supabase, userId);
      quotaState = quotaStateFor(prof?.plan_id ?? 'basic', prof?.role ?? null, used);
      if (quotaState.isOver) {
        return NextResponse.json(
          {
            error: `Quota mensuel atteint (${quotaState.used} / ${quotaState.quota} commandes en plan ${quotaState.planLabel}).`,
            code: 'PLAN_QUOTA_REACHED',
            hint: 'Passez au plan supérieur pour continuer à synchroniser ce mois-ci.',
            quota: quotaState,
          },
          { status: 402 }
        );
      }
    }

    // 1. Récupérer toutes les commandes depuis ZREXpress
    const parcels = await fetchAllParcels(token, tenantId);
    if (parcels.length === 0) {
      return NextResponse.json({ synced: 0, message: 'Aucune commande trouvée sur ZREXpress' });
    }

    const syncedAt = new Date().toISOString();

    const allRows = parcels
      .map((p) => mapParcel(p, syncedAt))
      .filter((r) => r.tracking_number)
      .map((r) => ({ ...r, user_id: userId }));

    const seen = new Set<string>();
    let rows = allRows.filter((r) => {
      if (seen.has(r.tracking_number)) return false;
      seen.add(r.tracking_number);
      return true;
    });

    // Si non-illimité : ne pas dépasser le quota mensuel restant. On tronque
    // pour ne pousser au maximum que ce qui rentre dans le plan.
    let quotaTruncated = 0;
    if (
      quotaState &&
      !quotaState.isUnlimited &&
      quotaState.remaining != null &&
      rows.length > quotaState.remaining
    ) {
      quotaTruncated = rows.length - quotaState.remaining;
      rows = rows.slice(0, quotaState.remaining);
    }

    const trackingNums = rows.map((r) => r.tracking_number);

    // 2. Charger les statuts actuels pour détecter les changements
    // Scopé par user_id : on ne regarde que les commandes de l'utilisateur courant
    // pour éviter de cross-contaminer les notifications entre comptes.
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('tracking_number, delivery_status, customer_whatsapp, customer_name, wilaya')
      .eq('user_id', userId)
      .in('tracking_number', trackingNums);

    const existingMap = new Map((existingOrders || []).map((o) => [o.tracking_number, o]));

    // 3. Identifier les commandes dont le statut a changé
    const toNotify: Array<{
      tracking_number: string;
      delivery_status: string;
      customer_whatsapp: string;
      customer_name: string;
      wilaya: string;
      product_name: string;
      cod: number;
    }> = [];
    for (const row of rows) {
      const existing = existingMap.get(row.tracking_number);
      // Vérifier si les notifications sont activées pour ce statut (true par défaut si non précisé)
      const isEnabled = notifyEnabled ? notifyEnabled[row.delivery_status] !== false : true;
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

    // 5. Notifications WhatsApp — FILE D'ATTENTE (anti-ban).
    // On N'ENVOIE PLUS en masse pendant le sync. À la place :
    //   a) chaque changement de statut est mis EN FILE (pending_notifications)
    //   b) on draine au plus DRAIN_PER_SYNC notifs, espacées, via le numéro
    //      Evolution connecté, sous le plafond journalier.
    // => jamais de burst, envoi étalé, zéro risque de suspension.

    // a) Mise en file (dédupliquée par index unique user+tracking+statut)
    if (toNotify.length > 0 && userId) {
      await supabase.from('pending_notifications').upsert(
        toNotify.map((n) => ({
          user_id: userId,
          tracking_number: n.tracking_number,
          delivery_status: n.delivery_status,
          customer_name: n.customer_name,
          customer_whatsapp: n.customer_whatsapp,
          wilaya: n.wilaya,
          product_name: n.product_name,
          cod: n.cod,
          status: 'pending',
        })),
        { onConflict: 'user_id,tracking_number,delivery_status', ignoreDuplicates: true }
      );
    }

    // b) Drain au compte-gouttes (≤ DRAIN_PER_SYNC, espacé, ≤ plafond/jour)
    const whatsappSent = userId ? await drainNotifications(supabase, userId, userTpl) : 0;

    return NextResponse.json({
      synced: count ?? rows.length,
      total: parcels.length,
      whatsapp_sent: whatsappSent,
      notifications: toNotify.length,
      message: `${rows.length} commandes synchronisées · ${whatsappSent} notifications WhatsApp envoyées${quotaTruncated > 0 ? ` · ${quotaTruncated} tronquées (quota mensuel)` : ''}`,
      ...(quotaTruncated > 0 && {
        quotaTruncated,
        quotaHint:
          'Quota mensuel atteint : passez au plan supérieur pour synchroniser toutes vos commandes.',
      }),
      ...(quotaState && !quotaState.isUnlimited && { quota: quotaState }),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
