import { logEvent } from '@/lib/security/safe-log';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabaseAuth = await createClient();
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const supabase = createServiceClient();
    // Paginé : PostgREST plafonne à 1 000 lignes, la corbeille était tronquée
    // sans avertissement. Tri stable (deleted_at, puis id).
    const data: Record<string, unknown>[] = [];
    for (let from = 0; from < 50_000; from += 1000) {
      const { data: page, error } = await supabase
        .from('orders')
        .select(
          'id, tracking_number, customer_name, wilaya, delivery_status, product_name, cod, deleted_at'
        )
        .eq('user_id', user.id)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + 999);
      if (error) {
        logEvent('error', 'api.orders.deleted', { status: 'failed', error_code: errorCode(error) });
        return NextResponse.json(
          { error: 'Erreur interne — réessaie dans un instant.' },
          { status: 500 }
        );
      }
      data.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    return NextResponse.json({ data });
  } catch (err) {
    logEvent('error', 'api.orders.deleted', { status: 'failed', error_code: errorCode(err) });
    return NextResponse.json(
      { error: 'Erreur interne — réessaie dans un instant.' },
      { status: 500 }
    );
  }
}

// Réponse générique : jamais le message brut (PostgREST cite filtres et valeurs).
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code ? code.slice(0, 40) : 'unknown';
}
