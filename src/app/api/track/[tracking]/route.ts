import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tracking: string }> }
) {
  try {
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
      tracking: data.tracking_number, client: data.customer_name, wilaya: data.wilaya,
      status: data.delivery_status, attempts: data.attempts, last_update: data.last_update, product: data.product_name,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erreur' }, { status: 500 });
  }
}
