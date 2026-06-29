-- ============================================================================
-- Correctif RLS sur la table `profiles`
-- ----------------------------------------------------------------------------
-- Problème : l'app n'arrivait pas à LIRE le profil de l'utilisateur connecté
-- (donc le rôle « admin » n'était jamais visible → pas de badge, pas de lien
-- Super Admin). Cause : soit la policy de lecture du propre profil manquait,
-- soit une vieille policy « admin » était RÉCURSIVE (elle interrogeait
-- `profiles` dans sa propre règle → « infinite recursion detected » → toute
-- lecture échoue).
--
-- Solution : des policies SIMPLES et non-récursives. Chaque utilisateur lit /
-- modifie SON profil. La gestion « voir tous les clients » (Super Admin) passe
-- désormais par une route serveur (service role), donc plus besoin de policy
-- admin récursive ici.
--
-- À exécuter une fois dans Supabase → SQL Editor.
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- On retire toutes les anciennes policies de profiles (dont la récursive)
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- Policies simples et non-récursives
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Rafraîchit le cache de l'API
NOTIFY pgrst, 'reload schema';
