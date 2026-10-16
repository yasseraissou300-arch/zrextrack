-- ============================================================================
-- PROPOSITION 009 — whatsapp_instances : lecture seule pour les tenants
-- (RLS-TENANT-001)
-- ----------------------------------------------------------------------------
-- ⛔ NON EXÉCUTÉE. GO humain explicite requis (changement RLS production).
--    Prérequis : PR « enforce whatsapp instance tenant ownership » DÉPLOYÉE
--    (le serveur écrit déjà avec la clé service_role, voir plus bas).
--
-- PROBLÈME
--   Politique historique (supabase_aichatbot*.sql) :
--     "whatsapp_instances_user_isolation" FOR ALL USING (auth.uid() = user_id)
--   Sans WITH CHECK ni restriction de colonne : un tenant peut, via PostgREST
--   (clé anon publique + sa session), INSÉRER ou MODIFIER ses lignes avec
--   n'importe quel instance_name — dont celui d'une instance d'un autre tenant
--   ou d'une instance Evolution absente de la table. Le serveur pilote toutes
--   les instances avec la clé Evolution GLOBALE.
--
-- GARANTIE VISÉE
--   anon           : aucun droit.
--   authenticated  : SELECT de SES lignes uniquement ; aucun INSERT/UPDATE/DELETE.
--   service_role   : inchangé (contourne la RLS ; seul écrivain légitime :
--                    /api/ai-chatbot/whatsapp/instance (upsert/delete),
--                    qr + status (connected), whatsapp/send (connected)).
--   Aucune donnée modifiée, aucune colonne/table supprimée, aucun DROP de
--   données : uniquement politiques et privilèges.
--
-- IDEMPOTENT : chaque étape vérifie l'état avant d'agir ; relancer = sans effet.
-- ROLLBACK   : 009_whatsapp_instances_rls_ROLLBACK.sql (rétablit l'état
--              historique exact).
-- ============================================================================

-- ── 0. Aperçu (lecture seule) — à lire AVANT d'appliquer ─────────────────────
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_instances';
SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'whatsapp_instances'
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY grantee;

BEGIN;

-- ── 1. RLS active ───────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

-- ── 2. Politique FOR ALL remplacée par une politique SELECT ─────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND tablename = 'whatsapp_instances'
             AND policyname = 'whatsapp_instances_user_isolation') THEN
    DROP POLICY "whatsapp_instances_user_isolation" ON public.whatsapp_instances;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'whatsapp_instances'
                 AND policyname = 'whatsapp_instances_select_own') THEN
    CREATE POLICY "whatsapp_instances_select_own" ON public.whatsapp_instances
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END
$$;

-- ── 3. Privilèges d'écriture retirés aux rôles client ───────────────────────
-- (même sans politique d'écriture, on retire le privilège : double barrière)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.whatsapp_instances FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_instances FROM anon;
GRANT SELECT ON public.whatsapp_instances TO authenticated;

-- ── 4. Vérification (dans la transaction) ───────────────────────────────────
SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'whatsapp_instances';
SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'whatsapp_instances'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee;
-- Attendu : une seule politique « whatsapp_instances_select_own » [SELECT] ;
-- authenticated = SELECT ; anon = aucune ligne.

-- Par défaut : ROLLBACK. Remplacer par COMMIT consciemment, après lecture,
-- et UNIQUEMENT avec le GO.
ROLLBACK;

-- ── 5. OPTIONNEL, décision séparée : unicité de instance_name ───────────────
-- Empêche aussi deux lignes de porter le même nom. Vérifier d'abord :
--   SELECT instance_name, count(*) FROM public.whatsapp_instances
--   GROUP BY instance_name HAVING count(*) > 1;
-- Si 0 ligne :
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS whatsapp_instances_instance_name_uniq
--     ON public.whatsapp_instances (instance_name);
-- (CONCURRENTLY : hors transaction ; échoue proprement s'il existe des doublons.)
