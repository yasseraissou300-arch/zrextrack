-- ROLLBACK de 007 — à n'exécuter que sur GO, si 007 a été appliquée.
-- Supprime uniquement le trigger et sa fonction ; aucune donnée touchée.
BEGIN;
DROP TRIGGER IF EXISTS profiles_protect_privileged ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_protect_privileged();
COMMIT;
