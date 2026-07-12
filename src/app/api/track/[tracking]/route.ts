import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// Endpoint public de suivi client. Renvoie l'état d'un colis à partir de son
// tracking_number. Deux protections :
//   1. Rate-limit — évite qu'un script énumère les trackings pour scraper les
//      données clients de la plateforme. Best-effort en mémoire : la Vercel
//      serverless recycle la mémoire au bout d'un moment, mais suffit à
//      bloquer un scraper naïf.
//   2. Masquage du nom — « Ahmed Belkacem » → « Ahmed B. ». L'acheteur légitime
//      reconnaît le format, un scraper récupère beaucoup moins d'infos utiles.

const RATE_WINDOW_MS = 60_000;   // 1 minute
const RATE_MAX_REQ   = 10;        // 10 requêtes / IP / minute

const hits = new Map<string, { count: number; windowStart: number }>();

function checkRate(ip: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return { ok: true, retryAfter: 0 };
  }
  entry.count++;
  if (entry.count > RATE_MAX_REQ) {
    return { ok: false, retryAfter: Math.ceil((RATE_WINDOW_MS - (now - entry.windowStart)) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

// « Ahmed Belkacem » → « Ahmed B. » (première initiale des noms de famille).
// Garde le prénom entier + juste les initiales des mots suivants.
function maskName(name: string | null): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts.slice(1).map(p => p.charAt(0).toUpperCase() + '.').join(' ');
}

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tracking: string }> }
) {
  try {
    const ip = getIp(req);
    const rate = checkRate(ip);
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'Trop de requêtes. Réessayez dans un instant.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
      );
    }

    const { tracking } = await params;
    if (!tracking) return NextResponse.json({ error: 'Tracking requis' }, { status: 400 });
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('orders')
      .select('tracking_number, customer_name, wilaya, delivery_status, attempts, last_update, product_name')
      .ilike('tracking_number', tracking.trim())
      .limit(1)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 });
    return NextResponse.json({
      tracking: data.tracking_number,
      client: maskName(data.customer_name),
      wilaya: data.wilaya,
      status: data.delivery_status,
      attempts: data.attempts,
      last_update: data.last_update,
      product: data.product_name,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur' }, { status: 500 });
  }
}
