-- ============================================================================
-- MIGRATION 007 — Colonnes privilégiées de public.profiles non modifiables
--                 par l'utilisateur (HUMAN-RLS-ROLE-001)
-- ----------------------------------------------------------------------------
-- 🚫 NON EXÉCUTÉE — GO explicite requis (touche le schéma public).
--
-- POURQUOI : la policy « Users can update own profile » (SQL versionné :
-- FOR UPDATE USING (auth.uid() = id), sans WITH CHECK ni restriction de
-- colonnes) permettrait à un marchand, avec la clé anon et son jeton, de
-- modifier SA ligne : role, plan_id (offre payante gratuite), status.
-- L'état réel de production n'est pas observable d'ici (HUMAN-RLS-ROLE-001).
-- La PR « admin via app_metadata » ferme le Super Admin ; ce trigger ferme
-- aussi plan_id / status / role pour toute requête d'un utilisateur.
--
-- PORTÉE : bloque seulement les requêtes des rôles `authenticated` et `anon`
-- (clé anon + jeton utilisateur). service_role (routes serveur, /api/admin)
-- et l'éditeur SQL (postgres) ne sont pas concernés.
--
-- GARANTIES : additif (une fonction, un trigger), aucune donnée modifiée,
-- aucun DROP, idempotent. Ne touche que les UPDATE qui CHANGENT une de ces
-- colonnes ; la modification du nom, de l'avatar, etc. reste possible.
--
-- PRÉREQUIS : vérifier qu'aucun flux client légitime ne modifie plan_id /
-- status / role avec la clé anon (vérifié dans le code : aucun .update() de
-- profiles côté navigateur ; /api/admin/users passe par service_role).
--
-- ROLLBACK : 007_profiles_protect_privileged_ROLLBACK.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.profiles_protect_privileged()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') AND (
       NEW.role    IS DISTINCT FROM OLD.role
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.status  IS DISTINCT FROM OLD.status
    OR NEW.id      IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'profiles: colonnes privilégiées non modifiables'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS profiles_protect_privileged ON public.profiles;
CREATE TRIGGER profiles_protect_privileged
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_privileged();

-- Vérification (read-only) — attendu : 1 ligne
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'profiles_protect_privileged';
