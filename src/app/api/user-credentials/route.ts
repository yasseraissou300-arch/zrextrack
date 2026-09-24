// CRUD des clés API par utilisateur — alimente la page /parametres/api-keys
// GET   → liste toutes les credentials de l'utilisateur courant (sans la clé brute)
// POST  → upsert d'une credential (user_id + service + valeurs)
// DELETE → supprime une credential (?service=gemini)

import { NextRequest, NextResponse } from 'next/server';
import { internalError } from '@/lib/security/safe-error';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { openCredential, sealCredential, type ServiceName } from '@/lib/user-creds';
import { maskSecret } from '@/lib/security/secret-box';

// Seul Gemini est configurable par l'utilisateur (BYOK). Evolution est
// partagé (serveur plateforme) ; GROQ / Claude / Green API sont retirés.
const ALLOWED: ServiceName[] = ['gemini'];

// Jamais plus des 4 derniers caractères (avant : 4 premiers + 4 derniers).
const maskKey = (key: string | null): string => maskSecret(key);

// Découpe un blob de clés (séparées par retour à la ligne / virgule / ;) en
// liste propre. Sert au pool de clés Gemini.
function splitKeys(key: string | null): string[] {
  if (!key) return [];
  return key
    .split(/[\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export async function GET() {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('user_api_credentials')
    .select('service, api_key, api_url, api_secret, is_active, updated_at')
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: 'Lecture impossible' }, { status: 500 });

  // On ne renvoie JAMAIS la clé en clair au navigateur. Seulement masquée +
  // un flag `configured`. Le user peut donc voir qu'il a une clé sans la lire.
  // La valeur stockée peut être chiffrée (P2-9) : on la déchiffre ici, côté
  // serveur, uniquement pour compter les clés du pool et masquer.
  const services = (data || []).map((row) => {
    const plain = openCredential(user.id, row.service, 'api_key', row.api_key);
    const keys = splitKeys(plain);
    return {
      service: row.service,
      configured: !!(plain || row.api_url),
      api_key_masked: maskKey(keys[0] ?? null),
      key_count: keys.length, // nombre de clés dans le pool
      keys_masked: keys.map(maskKey), // chaque clé masquée
      api_url: row.api_url ?? null,
      is_active: row.is_active,
      updated_at: row.updated_at,
    };
  });

  return NextResponse.json({ services });
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: {
    service?: string;
    api_key?: string;
    api_url?: string;
    api_secret?: string;
    is_active?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const service = body.service as ServiceName | undefined;
  if (!service || !ALLOWED.includes(service)) {
    return NextResponse.json({ error: 'Service inconnu' }, { status: 400 });
  }

  // Validation : les services restants (gemini, greenapi) requièrent une clé.
  const apiKey = (body.api_key ?? '').trim() || null;
  const apiUrl = (body.api_url ?? '').trim() || null;
  const apiSecret = (body.api_secret ?? '').trim() || null;

  if (!apiKey) {
    return NextResponse.json({ error: 'Clé API requise' }, { status: 400 });
  }

  let sealedKey: string;
  let sealedSecret: string | null;
  try {
    sealedKey = sealCredential(user.id, service, 'api_key', apiKey);
    sealedSecret = apiSecret ? sealCredential(user.id, service, 'api_secret', apiSecret) : null;
  } catch {
    // SECRETS_REQUIRE_ENCRYPTION=1 sans trousseau : refus plutôt que clair.
    return NextResponse.json({ error: 'Chiffrement indisponible' }, { status: 503 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('user_api_credentials').upsert(
    {
      user_id: user.id,
      service,
      api_key: sealedKey,
      api_url: apiUrl,
      api_secret: sealedSecret,
      is_active: body.is_active !== false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,service' }
  );

  if (error) return NextResponse.json({ error: 'Enregistrement impossible' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabaseAuth = await createClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
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

  if (error) return internalError('api.user-credentials', error);
  return NextResponse.json({ ok: true });
}
