import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';

// Map ZREXpress parcel status → our internal status
function mapStatus(state: string): string {
  const s = (state || '').toLowerCase().replace(/\s+/g, '_');
  if (s.includes('livr') && !s.includes('en_')) return 'livre';
  if (s.includes('en_pr') || s.includes('preparation') || s.includes('recue') || s.includes('recu')) return 'en_preparation';
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

    // Handle both array response and paginated response
    if (Array.isArray(data)) {
      all.push(...data);
      break;
    }

    const items = data.items || data.content || data.data || data.parcels || [];
    all.push(...items);

    totalPages = data.totalPages ?? data.total_pages ?? 1;
    pageNumber++;

    // Safety cap at 50 pages
    if (pageNumber > 50) break;
  }

  return all;
}

// Map a ZREXpress parcel to our orders table row
function mapParcel(p: any) {
  // Tracking number
  const tracking =
    p.trackingNumber || p.trackingCode || p.tracking_code || p.tracking || p.barcode || p.id || '';

  // Customer name
  const client =
    p.customer?.name || p.recipientName || p.recipient_name || p.clientName || p.client_name || '';

  // Phone: customer.phone is an object { number1, number2, number3 }
  const phoneObj = p.customer?.phone || {};
  const whatsapp =
    phoneObj.number1 || phoneObj.number2 || phoneObj.number3 ||
    p.recipientPhone || p.recipient_phone || p.clientPhone || p.phone || '';

  // Delivery city (wilaya)
  const wilaya =
    p.deliveryAddress?.city || p.deliveryAddress?.district ||
    p.wilaya?.name || p.wilayaName || p.wilaya_name ||
    (typeof p.wilaya === 'string' ? p.wilaya : '') || p.city || '';

  // Product: use description or first ordered product name
  const product =
    p.description || p.productsDescription ||
    (p.orderedProducts && p.orderedProducts.length > 0 ? p.orderedProducts[0].productName : '') ||
    p.productName || p.product_name || p.product?.name || '';

  // COD amount
  const cod =
    p.amount ?? p.price ?? p.cod ?? p.codAmount ?? p.cod_amount ?? 0;

  // Status
  const rawStatus =
    p.state?.name || p.stateName || p.status?.name || p.statusName || p.state || p.status || '';
  const status = mapStatus(rawStatus);

  // Attempts
  const attempts =
    p.deliveryAttempts ?? p.delivery_attempts ?? p.attempts ?? 0;

  const created_at =
    p.createdAt || p.created_at || new Date().toISOString();
  const last_update =
    p.lastStateUpdateAt || p.updatedAt || p.updated_at || p.lastUpdate || p.last_update || new Date().toISOString();

  return {
    tracking: String(tracking),
    client: String(client),
    whatsapp: String(whatsapp),
    wilaya: String(wilaya),
    product: String(product),
    cod: Number(cod),
    status,
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

    // Get current user ID from session cookies
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    const userId = user?.id ?? null;

    // Fetch parcels from ZREXpress
    const parcels = await fetchAllParcels(token, tenantId);
    if (parcels.length === 0) {
      return NextResponse.json({ synced: 0, message: 'Aucune commande trouvée sur ZREXpress' });
    }

    // Map to our schema and deduplicate by tracking number
    const allRows = parcels.map(mapParcel).filter(r => r.tracking).map(r => ({ ...r, user_id: userId }));
    const seen = new Set<string>();
    const rows = allRows.filter(r => {
      if (seen.has(r.tracking)) return false;
      seen.add(r.tracking);
      return true;
    });

    // Upsert into Supabase (service role bypasses RLS)
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
