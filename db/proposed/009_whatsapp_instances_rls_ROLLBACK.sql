-- ============================================================================
-- ROLLBACK de 009 — rétablit l'état historique de whatsapp_instances
-- ----------------------------------------------------------------------------
-- ⚠️ Rouvre RLS-TENANT-001 côté base (le contrôle serveur de la PR reste
--    actif). Uniquement si 009 a cassé un usage légitime non identifié.
-- Idempotent. Aucune donnée touchée.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND tablename = 'whatsapp_instances'
             AND policyname = 'whatsapp_instances_select_own') THEN
    DROP POLICY "whatsapp_instances_select_own" ON public.whatsapp_instances;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'whatsapp_instances'
                 AND policyname = 'whatsapp_instances_user_isolation') THEN
    CREATE POLICY "whatsapp_instances_user_isolation" ON public.whatsapp_instances
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END
$$;

-- Privilèges par défaut de Supabase sur public pour les rôles client.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_instances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_instances TO anon;

-- Par défaut : ROLLBACK. Remplacer par COMMIT consciemment, avec GO.
ROLLBACK;
