// Cross-device sync settings — remplace localStorage.
// GET → renvoie les settings du user courant (ou null si jamais sauvegardé)
// PUT → upsert les settings du user courant

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('user_sync_settings')
    .select('zrexpress_token, zrexpress_tenant_id, templates, notify_enabled, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    settings: data ?? {
      zrexpress_token: null,
      zrexpress_tenant_id: null,
      templates: {},
      notify_enabled: {},
      updated_at: null,
    },
  });
}

export async function PUT(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
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

  // Upsert partiel — on n'écrase que ce qui est fourni. On lit d'abord la ligne
  // existante pour préserver les autres champs.
  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from('user_sync_settings')
    .select('zrexpress_token, zrexpress_tenant_id, templates, notify_enabled')
    .eq('user_id', user.id)
    .maybeSingle();

  const row = {
    user_id: user.id,
    zrexpress_token: body.zrexpress_token !== undefined ? (body.zrexpress_token || null) : (existing?.zrexpress_token ?? null),
    zrexpress_tenant_id: body.zrexpress_tenant_id !== undefined ? (body.zrexpress_tenant_id || null) : (existing?.zrexpress_tenant_id ?? null),
    templates: body.templates !== undefined ? body.templates : (existing?.templates ?? {}),
    notify_enabled: body.notify_enabled !== undefined ? body.notify_enabled : (existing?.notify_enabled ?? {}),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_sync_settings')
    .upsert(row, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
