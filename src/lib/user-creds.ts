// BYOK — Helper pour charger les credentials API de l'utilisateur courant
// depuis Supabase au lieu des variables d'environnement globales.
//
// Architecture (décision produit) :
//   - Gemini   = BYOK. Chaque client utilise SA propre clé Gemini (meilleur
//                modèle pour la darija algérienne). C'est le SEUL modèle IA.
//   - Evolution = PARTAGÉ. Tous les clients connectent leur numéro WhatsApp
//                via le serveur Evolution de la plateforme (pas de BYOK).
//                Voir resolveEvolutionCreds — toujours les env vars.
//   - GROQ / Claude = retirés de la plateforme.

import { createServiceClient } from '@/lib/supabase/server';

// Seul Gemini est stocké par utilisateur (BYOK). Evolution = partagé,
// GROQ/Claude/GreenAPI = retirés de la plateforme.
export type ServiceName = 'gemini';

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
 * Résolution Evolution API — TOUJOURS le serveur partagé de la plateforme.
 * Evolution sert uniquement à connecter le numéro WhatsApp ; tous les clients
 * passent par le même serveur (le vôtre). Pas de BYOK. La signature
 * (userId, Promise) est conservée car ~10 routes l'appellent déjà.
 */
export async function resolveEvolutionCreds(_userId?: string): Promise<{ url: string; key: string }> {
  return {
    url: process.env.EVOLUTION_API_URL || '',
    key: process.env.EVOLUTION_API_KEY || '',
  };
}

/**
 * Résolution Gemini stricte — pas de fallback aux env vars. Retourne null si
 * l'utilisateur n'a pas configuré sa clé. L'appelant traite null comme
 * "feature désactivée" (le bot ne répond pas / route admin renvoie
 * missingCredentialsResponse). Gemini est le SEUL modèle IA de la plateforme.
 */
export async function resolveGeminiKey(userId: string): Promise<string | null> {
  const creds = await getUserCreds(userId, 'gemini');
  return creds?.api_key || null;
}
