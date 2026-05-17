import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Statuses considered as a successful delivery in the orders table.
const DELIVERED_STATUSES = ['livre'];
// Statuses considered as a definitive failure (parcel did not reach customer).
const FAILED_STATUSES = ['echec', 'retourne'];

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();

  // 1. All successful swap executions for this user
  const { data: swaps, error: swapErr } = await supabase
    .from('autoswap_log')
    .select('source_tracking, target_tracking, estimated_savings, executed_at')
    .eq('user_id', user.id)
    .eq('status', 'success');

  // Gracefully handle missing table — return zeroed stats so the UI can show
  // an empty state instead of an error.
  //  - Postgres code 42P01 = "undefined_table" (raw SQL error)
  //  - PostgREST code PGRST205 = "Could not find the table in the schema cache"
  if (swapErr) {
    const code = (swapErr as { code?: string }).code;
    const isMissingTable =
      code === '42P01' ||
      code === 'PGRST205' ||
      /relation .* does not exist/i.test(swapErr.message) ||
      /could not find the table/i.test(swapErr.message);
    if (isMissingTable) {
      return NextResponse.json({
        total_swaps: 0,
        delivered: 0,
        failed: 0,
        in_progress: 0,
        unknown: 0,
        delivery_rate: 0,
        total_savings: 0,
        note: 'autoswap_log table not found — run supabase_autoswap.sql migration.',
      });
    }
    return NextResponse.json({ error: swapErr.message, code }, { status: 500 });
  }

  const totalSwaps = swaps?.length ?? 0;
  const totalSavings = (swaps ?? []).reduce((sum, s) => sum + (Number(s.estimated_savings) || 0), 0);

  // After a swap, the SOURCE parcel physically carries the new shipment to the
  // target customer. So the source_tracking is what we track for delivery outcome.
  const sourceTrackings = (swaps ?? []).map(s => s.source_tracking).filter(Boolean);

  let delivered = 0;
  let failed = 0;
  let inProgress = 0;
  let unknown = 0;

  if (sourceTrackings.length > 0) {
    const { data: orders, error: ordErr } = await supabase
      .from('orders')
      .select('tracking_number, delivery_status')
      .in('tracking_number', sourceTrackings);

    if (ordErr) {
      return NextResponse.json({ error: ordErr.message }, { status: 500 });
    }

    const byTracking = new Map<string, string>();
    for (const o of orders ?? []) {
      if (o.tracking_number) byTracking.set(o.tracking_number, o.delivery_status ?? '');
    }

    for (const t of sourceTrackings) {
      const status = byTracking.get(t);
      if (status === undefined) {
        unknown += 1;
      } else if (DELIVERED_STATUSES.includes(status)) {
        delivered += 1;
      } else if (FAILED_STATUSES.includes(status)) {
        failed += 1;
      } else {
        inProgress += 1;
      }
    }
  }

  const deliveryRate = totalSwaps > 0
    ? Math.round((delivered / totalSwaps) * 1000) / 10 // 1 decimal
    : 0;

  return NextResponse.json({
    total_swaps: totalSwaps,
    delivered,
    failed,
    in_progress: inProgress,
    unknown,
    delivery_rate: deliveryRate,
    total_savings: totalSavings,
  });
}
