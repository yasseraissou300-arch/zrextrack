// Cross-device sync settings — remplace localStorage.
// GET → réglages du user courant. La clé API ZRExpress n'est JAMAIS renvoyée :
//       seulement `zrexpress_configured` et ses 4 derniers caractères (P2-9).
// PUT → upsert partiel. La clé est en ÉCRITURE SEULE (chiffrée si le
//       trousseau SECRETS_KEYRING est configuré).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { publicZrStatus, sealZrToken } from '@/lib/zrexpress/credentials';

export async function GET() {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('user_sync_settings')
    .select('zrexpress_token, zrexpress_tenant_id, templates, notify_enabled, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'Lecture impossible' }, { status: 500 });
  return NextResponse.json({
    settings: {
      ...publicZrStatus(user.id, data?.zrexpress_token),
      zrexpress_tenant_id: data?.zrexpress_tenant_id ?? null,
      templates: data?.templates ?? {},
      notify_enabled: data?.notify_enabled ?? {},
      updated_at: data?.updated_at ?? null,
    },
  });
}

export async function PUT(request: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: {
    zrexpress_token?: string | null;
    zrexpress_tenant_id?: string | null;
    templates?: Record<string, string>;
    notify_enabled?: Record<string, boolean>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  // Upsert partiel — on n'écrase que ce qui est fourni. La valeur stockée de
  // la clé est recopiée TELLE QUELLE (jamais déchiffrée) si non fournie.
  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from('user_sync_settings')
    .select('zrexpress_token, zrexpress_tenant_id, templates, notify_enabled')
    .eq('user_id', user.id)
    .maybeSingle();

  let zrexpress_token: string | null = existing?.zrexpress_token ?? null;
  if (body.zrexpress_token !== undefined) {
    const t = (body.zrexpress_token ?? '').trim();
    try {
      zrexpress_token = t ? sealZrToken(user.id, t) : null;
    } catch {
      // SECRETS_REQUIRE_ENCRYPTION=1 sans trousseau : refus plutôt que clair.
      return NextResponse.json({ error: 'Chiffrement indisponible' }, { status: 503 });
    }
  }

  const row = {
    user_id: user.id,
    zrexpress_token,
    zrexpress_tenant_id:
      body.zrexpress_tenant_id !== undefined
        ? body.zrexpress_tenant_id || null
        : (existing?.zrexpress_tenant_id ?? null),
    templates: body.templates !== undefined ? body.templates : (existing?.templates ?? {}),
    notify_enabled:
      body.notify_enabled !== undefined ? body.notify_enabled : (existing?.notify_enabled ?? {}),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_sync_settings')
    .upsert(row, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
