import { NextRequest, NextResponse } from 'next/server';
import { internalError } from '@/lib/security/safe-error';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getZrCredentials, ZR_NOT_CONFIGURED } from '@/lib/zrexpress/credentials';
import { mapStatus } from '@/lib/zrexpress/status';
import {
  diffOrders,
  loadExistingOrders,
  statusChanged,
  upsertOrdersInChunks,
} from '@/lib/zrexpress/sync-diff';
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
    // La clé ZR n'est PLUS lue dans le corps (P2-9) : celle du tenant de la
    // session, lue en base, fait foi. Une clé injectée par le client est ignorée.
    const { notifyEnabled } = await request.json().catch(() => ({}));

    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    // Session OBLIGATOIRE. Sans elle, l'ancien code appelait ZRExpress, sautait
    // le quota et upsertait tous les colis avec user_id = NULL : NULL ne viole
    // jamais l'index unique (user_id, tracking_number), donc chaque appel
    // anonyme insérait des lignes orphelines dans `orders` (colonne nullable
    // d'après supabase_orders.sql). Le middleware laisse /api/* passer.
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const userId = user.id;

    const supabase = createServiceClient();

    const zr = await getZrCredentials(supabase, userId);
    if (!zr) return NextResponse.json(ZR_NOT_CONFIGURED, { status: 400 });
    const { token, tenantId } = zr;

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

    // 2. Charger TOUT l'existant du tenant (paginé) pour détecter les
    // changements — voir src/lib/zrexpress/sync-diff.ts. L'ancien
    // `.in(<tous les suivis>)` plafonnait à 1 000 lignes : le reste passait
    // pour « nouveau » et déclenchait des notifications de colis anciens.
    // null = lecture échouée → aucune notification (dans le doute).
    const existingMap = userId ? await loadExistingOrders(supabase, userId) : null;

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
      // Vérifier si les notifications sont activées pour ce statut (true par défaut si non précisé)
      const isEnabled = notifyEnabled ? notifyEnabled[row.delivery_status] !== false : true;
      if (
        NOTIFY_STATUSES.has(row.delivery_status) &&
        isEnabled &&
        row.customer_whatsapp &&
        row.customer_whatsapp.length > 4 &&
        statusChanged(existingMap, row)
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
    // Seules les lignes nouvelles ou modifiées sont écrites (avant : toutes,
    // ≈ 5 000 par passage). Lecture de l'existant échouée → tout est écrit,
    // comme avant.
    const diff = existingMap ? diffOrders(rows, existingMap) : null;
    const { written, error } = await upsertOrdersInChunks(supabase, diff ? diff.toWrite : rows);

    if (error) {
      return internalError('api.sync-zrexpress', error);
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
      synced: rows.length,
      written,
      ...(diff && { created: diff.created, updated: diff.updated, unchanged: diff.unchanged }),
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
    return internalError('api.sync-zrexpress', err);
  }
}
