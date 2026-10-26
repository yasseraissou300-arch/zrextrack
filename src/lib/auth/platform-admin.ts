// Super Admin de la plateforme — source d'autorité : `app_metadata.role` du
// jeton Supabase Auth.
//
// Avant : `profiles.role = 'admin'`. Or `profiles` est la ligne de
// l'utilisateur LUI-MÊME : selon les policies RLS de production (non
// observables d'ici, HUMAN-RLS-ROLE-001), un marchand pourrait faire
// `update profiles set role = 'admin' where id = auth.uid()` avec la clé anon
// publique et obtenir la lecture de TOUS les marchands et la modification de
// leur offre / statut.
//
// `app_metadata` n'est modifiable qu'avec la clé service-role (Auth Admin API) :
// jamais par l'utilisateur. `user_metadata`, lui, EST modifiable par
// l'utilisateur (supabase.auth.updateUser) : ne jamais le lire ici.

export interface AuthUserLike {
  app_metadata?: Record<string, unknown> | null;
}

export function isPlatformAdmin(user: AuthUserLike | null | undefined): boolean {
  return user?.app_metadata?.role === 'admin';
}

/**
 * Variante côté serveur SANS session (file de jobs, cron) : relit l'utilisateur
 * via l'API Auth Admin (clé service-role). Toute erreur → false (jamais
 * admin par défaut).
 */
export async function isPlatformAdminById(
  service: { auth?: { admin?: { getUserById?: (id: string) => Promise<unknown> } } },
  userId: string
): Promise<boolean> {
  try {
    const getUserById = service.auth?.admin?.getUserById;
    if (!getUserById) return false;
    const res = (await getUserById.call(service.auth!.admin, userId)) as {
      data?: { user?: AuthUserLike | null };
    };
    return isPlatformAdmin(res?.data?.user ?? null);
  } catch {
    return false;
  }
}
