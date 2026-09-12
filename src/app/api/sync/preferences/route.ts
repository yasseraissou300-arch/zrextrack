// Préférences de synchronisation serveur — Phase 1.
//
// Route SÉPARÉE de /api/sync-settings, délibérément : celle-ci écrit dans
// `autotim.tenant_settings`, jamais dans `public.user_sync_settings`.
// Garder les deux distinctes évite qu'un futur changement sur l'une touche
// par accident le schéma partagé.
//
// GET  → état courant (créé à la volée si absent, avec les valeurs par défaut)
// PUT  → { auto_sync_enabled?, sync_source? }
//
// `sync_source` n'est PAS librement modifiable par l'utilisateur : la bascule
// client → both → server est une opération d'exploitation, pilotée par
// l'administrateur pendant la migration progressive. Le client ne peut que
// pousser `auto_sync_enabled` (l'état qui vivait jusqu'ici dans localStorage).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getTenantSettings, upsertTenantSettings } from '@/lib/queue/repository';
import type { SyncSource } from '@/lib/queue/types';

const SOURCES: SyncSource[] = ['client', 'server', 'both'];

export async function GET() {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const service = createServiceClient();
  const settings = await getTenantSettings(service, user.id);

  return NextResponse.json({
    tenant_id: user.id,
    auto_sync_enabled: settings?.auto_sync_enabled ?? false,
    // Défaut 'client' : aucun tenant n'est basculé automatiquement.
    sync_source: settings?.sync_source ?? 'client',
    last_synced_at: settings?.last_synced_at ?? null,
    circuit_open_until: settings?.circuit_open_until ?? null,
    consecutive_send_failures: settings?.consecutive_send_failures ?? 0,
  });
}

export async function PUT(request: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: { auto_sync_enabled?: boolean; sync_source?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (typeof body.auto_sync_enabled === 'boolean') {
    patch.auto_sync_enabled = body.auto_sync_enabled;
  }

  // La bascule de source est réservée à l'admin : c'est une étape de la
  // migration progressive, pas une préférence utilisateur.
  if (body.sync_source !== undefined) {
    const { data: prof } = await createServiceClient()
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (prof?.role !== 'admin') {
      return NextResponse.json(
        { error: "sync_source n'est modifiable que par un administrateur" },
        { status: 403 }
      );
    }
    if (!SOURCES.includes(body.sync_source as SyncSource)) {
      return NextResponse.json(
        { error: `sync_source doit valoir ${SOURCES.join(', ')}` },
        { status: 400 }
      );
    }
    patch.sync_source = body.sync_source;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ modifiable fourni' }, { status: 400 });
  }

  await upsertTenantSettings(createServiceClient(), user.id, patch);
  return NextResponse.json({ ok: true, ...patch });
}
