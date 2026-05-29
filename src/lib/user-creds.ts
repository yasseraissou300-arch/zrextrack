// BYOK — Helper pour charger les credentials API de l'utilisateur courant
// (Gemini, GROQ, Evolution, etc.) depuis Supabase au lieu des variables
// d'environnement globales. Utilisé par toutes les routes /api qui consomment
// un service tiers — bloque proprement si le user n'a pas configuré sa clé.

import { createServiceClient } from '@/lib/supabase/server';

// Claude/Anthropic retiré de la plateforme.
export type ServiceName = 'gemini' | 'groq' | 'evolution' | 'greenapi';

export interface UserCreds {
  api_key: string | null;
  api_url: string | null;
  api_secret: string | null;
}

/**
 * Charge les credentials d'un service pour un utilisateur donné.
 * Retourne null si rien n'est configuré ou si la ligne est désactivée.
 * Utilise le service client (bypass RLS) — l'appelant doit déjà avoir
 * vérifié l'identité de l'utilisateur.
 */
export async function getUserCreds(
  userId: string,
  service: ServiceName,
): Promise<UserCreds | null> {
  if (!userId) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('user_api_credentials')
    .select('api_key, api_url, api_secret, is_active')
    .eq('user_id', userId)
    .eq('service', service)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  if (!data.api_key && !data.api_url) return null;

  return {
    api_key: data.api_key ?? null,
    api_url: data.api_url ?? null,
    api_secret: data.api_secret ?? null,
  };
}

/**
 * Réponse standardisée à renvoyer quand un user appelle une route qui exige
 * un service tiers mais n'a pas configuré sa clé. Le frontend peut détecter
 * `code === 'missing_credentials'` pour afficher un CTA vers /parametres/api-keys.
 */
export function missingCredentialsResponse(service: ServiceName) {
  return {
    error: `Clé API manquante pour ${service}. Configurez-la dans Paramètres → Clés API.`,
    code: 'missing_credentials' as const,
    service,
    redirect: '/parametres/api-keys',
  };
}

/**
 * Résolution Evolution API pour un utilisateur — utilisée par les ~10 routes
 * d'administration WhatsApp. Si l'utilisateur a configuré ses propres creds,
 * on les utilise. Sinon on retombe sur les variables d'environnement
 * (serveur Evolution partagé de la plateforme) pour ne pas casser les
 * instances existantes créées avant la mise en place de BYOK.
 */
export async function resolveEvolutionCreds(userId: string): Promise<{ url: string; key: string }> {
  const creds = await getUserCreds(userId, 'evolution');
  return {
    url: creds?.api_url || process.env.EVOLUTION_API_URL || '',
    key: creds?.api_key || process.env.EVOLUTION_API_KEY || '',
  };
}

/**
 * Résolution Gemini stricte — pas de fallback aux env vars. Retourne null si
 * l'utilisateur n'a pas configuré sa clé. L'appelant doit traiter null comme
 * "feature désactivée" (ex: cascade IA saute Gemini, route admin renvoie
 * missingCredentialsResponse).
 */
export async function resolveGeminiKey(userId: string): Promise<string | null> {
  const creds = await getUserCreds(userId, 'gemini');
  return creds?.api_key || null;
}

/**
 * Résolution GROQ stricte — pas de fallback aux env vars. Même sémantique que
 * resolveGeminiKey.
 */
export async function resolveGroqKey(userId: string): Promise<string | null> {
  const creds = await getUserCreds(userId, 'groq');
  return creds?.api_key || null;
}
