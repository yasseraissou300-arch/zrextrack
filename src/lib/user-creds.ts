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
 * Pool de clés Gemini de l'utilisateur. Les clés sont stockées dans api_key
 * séparées par retour à la ligne (ou virgule / point-virgule). Permet la
 * rotation : quand une clé épuise son quota gratuit (429), le bot passe à la
 * suivante. Pour multiplier le quota, les clés doivent venir de comptes Google
 * DIFFÉRENTS (le quota gratuit est par projet).
 *
 * Retourne un tableau (vide si rien configuré).
 */
export async function resolveGeminiKeys(userId: string): Promise<string[]> {
  const creds = await getUserCreds(userId, 'gemini');
  if (!creds?.api_key) return [];
  return creds.api_key
    .split(/[\n,;]+/)
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

/**
 * Première clé Gemini du pool (compat. pour les routes admin/test qui n'ont pas
 * besoin de rotation). null si aucune clé configurée.
 */
export async function resolveGeminiKey(userId: string): Promise<string | null> {
  const keys = await resolveGeminiKeys(userId);
  return keys[0] ?? null;
}
