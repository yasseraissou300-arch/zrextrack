import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';

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

async function fetchAllParcels(token: string): Promise<any[]> {
  const all: any[] = [];
  let page = 0;
  const size = 100;
  let totalPages = 1;

  while (page < totalPages) {
    const res = await fetch(`${ZREXPRESS_API}/parcels/search`, {
      method: 'POST',
      headers: {
        'X-Api-Key': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page, size }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ZREXpress API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json();

    if (Array.isArray(data)) {
      all.push(...data);
      break;
    }

    const items = data.content || data.items || data.data || data.parcels || [];
    all.push(...items);
    totalPages = data.totalPages ?? data.total_pages ?? 1;
    page++;
    if (page >= 50) break;
  }

  return all;
}

function mapParcel(p: any) {
  const tracking = p.trackingCode || p.tracking_code || p.tracking || p.barcode || p.id || '';
  const client = p.recipientName || p.recipient_name || p.clientName || p.client_name || p.customer?.name || p.recipient?.name || '';
  const whatsapp = p.recipientPhone || p.recipient_phone || p.phone || p.clientPhone || p.customer?.phone || p.recipient?.phone || '';
  const wilaya = p.wilaya?.name || p.wilayaName || p.wilaya_name || p.wilaya || p.city || '';
  const product = p.productName || p.product_name || p.product?.name || p.description || '';
  const cod = p.price ?? p.cod ?? p.codAmount ?? p.cod_amount ?? p.amount ?? 0;
  const rawStatus = p.state?.name || p.stateName || p.status?.name || p.statusName || p.state || p.status || '';
  const status = mapStatus(rawStatus);
  const attempts = p.deliveryAttempts ?? p.delivery_attempts ?? p.attempts ?? 0;
  const created_at = p.createdAt || p.created_at || new Date().toISOString();
  const last_update = p.updatedAt || p.updated_at || p.lastUpdate || p.last_update || new Date().toISOString();

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
    const { token } = await request.json();
    if (!token) {
      return NextResponse.json({ error: 'Token manquant' }, { status: 400 });
    }

    const parcels = await fetchAllParcels(token);
    if (parcels.length === 0) {
      return NextResponse.json({ synced: 0, total: 0, message: 'Aucune commande trouvée sur ZREXpress' });
    }

    const rows = parcels.map(mapParcel).filter(r => r.tracking);
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
