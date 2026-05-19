// Enrichit chaque réclamation SAV avec les données réelles du colis ZRExpress.
//
// Stratégie de matching (la première qui matche gagne) :
//   1. Tracking number exact      → ex « 23-9CBIUKT661-ZR »
//   2. externalId exact            → ID interne du marchand
//   3. Numéro de téléphone client  → fallback si le client a donné un n° invalide
//
// Pour éviter N appels ZRExpress (un par réclamation), on fetch toute la page
// une seule fois et on indexe localement. L'API n'a pas de filtre serveur sur
// tracking/external/phone, donc on récupère et on filtre côté AutoTim.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ZREXPRESS_API = 'https://api.zrexpress.app/api/v1.0';

interface LookupItem {
  sessionId: string;
  commande: string | null;
  phone: string | null;       // ex "213556172674" — sans préfixe ni @
}

interface ZRParcelMinimal {
  id: string;
  trackingNumber: string;
  externalId?: string;
  state?: { name?: string };
  amount?: number;
  customer?: { name?: string; phone?: { number1?: string; number2?: string; number3?: string } };
  deliveryAddress?: { city?: string; cityTerritoryCode?: number };
}

interface LookupResult {
  sessionId: string;
  matchedBy: 'tracking' | 'externalId' | 'phone' | null;
  parcel: {
    id: string;
    tracking: string;
    state: string;
    amount: number;
    customerName: string;
    customerPhone: string;
    city: string;
    wilayaCode: number;
  } | null;
}

function normalizeTracking(s: string): string {
  return (s || '').toUpperCase().trim();
}

function normalizePhone(s: string): string {
  const c = (s || '').replace(/[\s\-()+.]/g, '').replace(/^@s\.whatsapp\.net$/, '');
  if (c.startsWith('213')) return c;
  if (c.startsWith('0')) return '213' + c.slice(1);
  return c;
}

async function fetchAllParcels(token: string, tenantId: string): Promise<ZRParcelMinimal[]> {
  const all: ZRParcelMinimal[] = [];
  let pageNumber = 1;
  let totalPages = 1;
  while (pageNumber <= totalPages) {
    const res = await fetch(`${ZREXPRESS_API}/parcels/search`, {
      method: 'POST',
      headers: { 'X-Api-Key': token, 'X-Tenant': tenantId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNumber, pageSize: 100 }),
    });
    if (!res.ok) throw new Error(`ZRExpress ${res.status}`);
    const data = await res.json();
    const items: ZRParcelMinimal[] = Array.isArray(data) ? data : (data.items ?? []);
    all.push(...items);
    if (!Array.isArray(data)) {
      totalPages = data.totalPages ?? 1;
    } else if (items.length < 100) {
      break;
    }
    pageNumber++;
    if (pageNumber > 100) break; // safety
  }
  return all;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { token, tenantId, items } = (await req.json()) as {
    token?: string;
    tenantId?: string;
    items?: LookupItem[];
  };

  if (!token || !tenantId) return NextResponse.json({ error: 'Clé API ZRExpress manquante' }, { status: 400 });
  if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ results: [] });

  let allParcels: ZRParcelMinimal[];
  try {
    allParcels = await fetchAllParcels(token, tenantId);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur ZRExpress' }, { status: 502 });
  }

  // Index pour O(1) lookup
  const byTracking = new Map<string, ZRParcelMinimal>();
  const byExternal = new Map<string, ZRParcelMinimal>();
  const byPhone = new Map<string, ZRParcelMinimal[]>();
  for (const p of allParcels) {
    if (p.trackingNumber) byTracking.set(normalizeTracking(p.trackingNumber), p);
    if (p.externalId) byExternal.set(normalizeTracking(p.externalId), p);
    const phones = [p.customer?.phone?.number1, p.customer?.phone?.number2, p.customer?.phone?.number3].filter(Boolean) as string[];
    for (const ph of phones) {
      const n = normalizePhone(ph);
      if (!n) continue;
      const list = byPhone.get(n) ?? [];
      list.push(p);
      byPhone.set(n, list);
    }
  }

  const results: LookupResult[] = items.map(item => {
    const commande = normalizeTracking(item.commande ?? '');
    const phone = normalizePhone(item.phone ?? '');

    let matched: ZRParcelMinimal | null = null;
    let matchedBy: LookupResult['matchedBy'] = null;

    if (commande) {
      if (byTracking.has(commande)) {
        matched = byTracking.get(commande)!;
        matchedBy = 'tracking';
      } else if (byExternal.has(commande)) {
        matched = byExternal.get(commande)!;
        matchedBy = 'externalId';
      }
    }

    // Fallback téléphone : si plusieurs colis pour ce numéro, on prend le plus récent
    // (premier dans la liste retournée par l'API, qui trie par date desc).
    if (!matched && phone && byPhone.has(phone)) {
      const list = byPhone.get(phone)!;
      matched = list[0];
      matchedBy = 'phone';
    }

    if (!matched) {
      return { sessionId: item.sessionId, matchedBy: null, parcel: null };
    }

    const customerPhone = matched.customer?.phone?.number1 || matched.customer?.phone?.number2 || '';
    return {
      sessionId: item.sessionId,
      matchedBy,
      parcel: {
        id: matched.id,
        tracking: matched.trackingNumber,
        state: matched.state?.name || 'unknown',
        amount: Number(matched.amount ?? 0),
        customerName: matched.customer?.name || '',
        customerPhone,
        city: matched.deliveryAddress?.city || '',
        wilayaCode: Number(matched.deliveryAddress?.cityTerritoryCode ?? 0),
      },
    };
  });

  return NextResponse.json({ results });
}
