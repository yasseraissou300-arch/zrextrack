import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';

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

// Fetch all pages from ZREXpress parcels/search
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

// Map a ZREXpress parcel to our orders table row
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

  const cod =
    p.amount ?? p.price ?? p.cod ?? p.codAmount ?? p.cod_amount ?? 0;

  const rawStatus =
    p.state?.name || p.stateName || p.status?.name || p.statusName || p.state || p.status || '';
  const status = mapStatus(rawStatus);

  const situation =
    p.situation?.name || p.situationName || p.situation || '';

  const delivery_type =
    p.deliveryType || p.delivery_type || p.type || '';

  const delivery_fees =
    p.deliveryPrice ?? p.delivery_price ?? p.deliveryFees ?? p.delivery_fees ?? p.fees ?? 0;

  const attempts =
    p.deliveryAttempts ?? p.delivery_attempts ?? p.attempts ?? 0;

  const created_at =
    p.createdAt || p.created_at || syncedAt;
  const last_update = syncedAt;

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
    created_at,
    last_update,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { token, tenantId } = await request.json();
    if (!token) {
      return NextResponse.json({ error: 'Clé API (secretKey) manquante' }, { status: 400 });
    }
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });
    }

    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    const userId = user?.id ?? null;

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

    const supabase = createServiceClient();
    const { error, count } = await supabase
      .from('orders')
      .upsert(rows, { onConflict: 'tracking', count: 'exact' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      synced: count ?? rows.length,
      total: parcels.length,
      message: `${rows.length} commandes synchronisées avec succès`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
