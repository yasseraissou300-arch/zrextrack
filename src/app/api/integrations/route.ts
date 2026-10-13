import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/security/safe-log';

// Le secret HMAC Shopify / WooCommerce (`secret_key`) sert UNIQUEMENT à vérifier
// les webhooks côté serveur. Il ne quitte jamais le serveur : le navigateur
// reçoit des colonnes explicites et `secret_configured` (booléen). L'interface
// (src/app/integrations/page.tsx) ne lit pas le secret : le champ du
// formulaire est en écriture seule.
const PUBLIC_COLUMNS =
  'id, platform, identifier, active, orders_synced, last_sync, created_at, updated_at';

interface IntegrationRow {
  id: string;
  platform: string;
  identifier: string;
  active: boolean;
  orders_synced: number | null;
  last_sync: string | null;
  created_at: string | null;
  updated_at: string | null;
  secret_key?: string | null;
}

function toPublic(row: IntegrationRow) {
  return {
    id: row.id,
    platform: row.platform,
    identifier: row.identifier,
    active: row.active,
    orders_synced: row.orders_synced,
    last_sync: row.last_sync,
    created_at: row.created_at,
    updated_at: row.updated_at,
    secret_configured: typeof row.secret_key === 'string' && row.secret_key.trim() !== '',
  };
}

export async function GET() {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('integrations')
    .select(`${PUBLIC_COLUMNS}, secret_key`)
    .eq('user_id', user.id)
    .order('created_at');

  return NextResponse.json({ data: ((data as IntegrationRow[] | null) ?? []).map(toPublic) });
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { platform, identifier, secret_key } = body;
  if (!platform || !identifier)
    return NextResponse.json({ error: 'platform et identifier requis' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('integrations')
    .upsert(
      {
        user_id: user.id,
        platform,
        identifier,
        secret_key: secret_key || '',
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,platform' }
    )
    .select(`${PUBLIC_COLUMNS}, secret_key`)
    .single();

  if (error) {
    // Le message PostgREST peut citer des valeurs de la ligne (dont le secret) :
    // seul le CODE est journalisé ; le navigateur reçoit un message générique.
    logEvent('error', 'api.integrations', {
      tenant_id: user.id,
      status: 'upsert_failed',
      error_code: typeof error.code === 'string' ? error.code : 'unknown',
    });
    return NextResponse.json(
      { error: 'Enregistrement impossible. Réessaie dans un instant.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ data: toPublic(data as IntegrationRow) });
}

export async function DELETE(request: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { platform } = await request.json();
  const supabase = createServiceClient();
  await supabase
    .from('integrations')
    .update({ active: false })
    .eq('user_id', user.id)
    .eq('platform', platform);
  return NextResponse.json({ success: true });
}
