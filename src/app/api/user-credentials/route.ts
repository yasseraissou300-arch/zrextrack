// CRUD des clés API par utilisateur — alimente la page /parametres/api-keys
// GET   → liste toutes les credentials de l'utilisateur courant (sans la clé brute)
// POST  → upsert d'une credential (user_id + service + valeurs)
// DELETE → supprime une credential (?service=gemini)

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import type { ServiceName } from '@/lib/user-creds';

const ALLOWED: ServiceName[] = ['gemini', 'groq', 'evolution', 'greenapi'];

function maskKey(key: string | null): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('user_api_credentials')
    .select('service, api_key, api_url, api_secret, is_active, updated_at')
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // On ne renvoie JAMAIS la clé en clair au navigateur. Seulement masquée +
  // un flag `configured`. Le user peut donc voir qu'il a une clé sans la lire.
  const services = (data || []).map(row => ({
    service: row.service,
    configured: !!(row.api_key || row.api_url),
    api_key_masked: maskKey(row.api_key),
    api_url: row.api_url ?? null,
    is_active: row.is_active,
    updated_at: row.updated_at,
  }));

  return NextResponse.json({ services });
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: { service?: string; api_key?: string; api_url?: string; api_secret?: string; is_active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const service = body.service as ServiceName | undefined;
  if (!service || !ALLOWED.includes(service)) {
    return NextResponse.json({ error: 'Service inconnu' }, { status: 400 });
  }

  // Validations minimales par service
  const apiKey = (body.api_key ?? '').trim() || null;
  const apiUrl = (body.api_url ?? '').trim() || null;
  const apiSecret = (body.api_secret ?? '').trim() || null;

  if (service === 'evolution') {
    if (!apiUrl || !apiKey) {
      return NextResponse.json({ error: 'Evolution requiert URL + clé API' }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(apiUrl)) {
      return NextResponse.json({ error: 'URL invalide (doit commencer par http:// ou https://)' }, { status: 400 });
    }
  } else {
    if (!apiKey) {
      return NextResponse.json({ error: 'Clé API requise' }, { status: 400 });
    }
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('user_api_credentials')
    .upsert(
      {
        user_id: user.id,
        service,
        api_key: apiKey,
        api_url: apiUrl,
        api_secret: apiSecret,
        is_active: body.is_active !== false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,service' },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const service = searchParams.get('service') as ServiceName | null;
  if (!service || !ALLOWED.includes(service)) {
    return NextResponse.json({ error: 'Service manquant' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('user_api_credentials')
    .delete()
    .eq('user_id', user.id)
    .eq('service', service);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
