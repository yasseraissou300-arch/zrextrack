import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';

function mapStatus(state: string): string {
  const s = (state || '').toLowerCase().replace(/\s+/g, '_');
  if (s.includes('livr') && !s.includes('en_')) return 'livre';
  if (s.includes('en_pr') || s.includes('preparation') || s.includes('recue') || s.includes('recu') || s.includes('dispatch') || s.includes('confirm')) return 'en_preparation';
  if (s.includes('transit')) return 'en_transit';
  if (s.includes('en_livr') || s.includes('sorti') || s.includes('distribution')) return 'en_livraison';
  if (s.includes('retour')) return 'retourne';
  if (s.includes('chec') || s.includes('annul') || s.includes('echec')) return 'echec';
  return 'en_preparation';
}

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

    const items = data.items || data.content || data.data || data.parcels || [];
    all.push(...items);

    totalPages = data.totalPages ?? data.total_pages ?? 1;
    pageNumber++;

    if (pageNumber > 50) break;
  }

  return all;
}

function mapParcel(p: any, syncedAt: string) {
  // Use real tracking number (e.g. "25-CAABE9MIS5-ZR"), fallback to id
  const tracking = p.trackingNumber || p.trackingCode || p.tracking_code || p.barcode || p.id || '';

  const client = p.customer?.name || p.recipientName || p.recipient_name || '';

  // customer.phone is { number1, number2, number3 }
  const phoneObj = (p.customer?.phone && typeof p.customer.phone === 'object') ? p.customer.phone : {};
  const whatsapp =
    phoneObj.number1 || phoneObj.number2 || phoneObj.number3 ||
    (typeof p.customer?.phone === 'string' ? p.customer.phone : '') ||
    p.recipientPhone || p.recipient_phone || '';

  // City from delivery address
  const wilaya = p.deliveryAddress?.city || p.deliveryAddress?.district || '';

  // Product: use productsDescription (more detailed), fallback to description
  const product =
    p.productsDescription ||
    p.description ||
    (p.orderedProducts && p.orderedProducts.length > 0 ? p.orderedProducts[0].productName : '') ||
    '';

  const cod = p.amount ?? p.price ?? p.cod ?? 0;

  const rawStatus = p.state?.name || p.status?.name || p.state || p.status || '';
  const status = mapStatus(rawStatus);

  const attempts = p.deliveryAttempts ?? p.delivery_attempts ?? p.attempts ?? 0;

  const created_at = p.createdAt || p.created_at || syncedAt;
  // Use sync time so latest sync rows appear at top
  const last_update = syncedAt;

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
    if (!token) return NextResponse.json({ error: 'Clé API (secretKey) manquante' }, { status: 400 });
    if (!tenantId) return NextResponse.json({ error: 'Tenant ID manquant' }, { status: 400 });

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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      synced: count ?? rows.length,
      total: parcels.length,
      message: `${rows.length} commandes synchronisées avec succès`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
