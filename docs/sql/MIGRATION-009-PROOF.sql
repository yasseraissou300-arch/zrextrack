-- ============================================================================
-- MIGRATION-009-PROOF — preuve, sur la VRAIE base, qu'un tenant ne peut pas
-- réécrire whatsapp_instances (RLS-TENANT-001). À exécuter APRÈS 009.
-- ----------------------------------------------------------------------------
-- Simule le tenant A (rôle authenticated + jeton) dans une transaction qui se
-- termine TOUJOURS par ROLLBACK : rien n'est conservé, même si 009 est absente.
-- Résultat : une grille (check, resultat) ; PASS attendu partout.
-- Aucune valeur de nom d'instance n'est affichée.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _proof (check_id text, resultat text) ON COMMIT DROP;
GRANT INSERT, SELECT ON _proof TO authenticated;

-- Tenant A = propriétaire d'une ligne existante ; B = un autre propriétaire.
CREATE TEMP TABLE _ids ON COMMIT DROP AS
SELECT (SELECT user_id FROM public.whatsapp_instances ORDER BY user_id LIMIT 1) AS a,
       (SELECT user_id FROM public.whatsapp_instances
         WHERE user_id <> (SELECT user_id FROM public.whatsapp_instances ORDER BY user_id LIMIT 1)
         ORDER BY user_id LIMIT 1) AS b;
GRANT SELECT ON _ids TO authenticated;

SELECT set_config('request.jwt.claim.sub', (SELECT a::text FROM _ids), true),
       set_config('request.jwt.claims',
                  json_build_object('sub', (SELECT a::text FROM _ids), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_a uuid := (SELECT a FROM _ids);
  v_b uuid := (SELECT b FROM _ids);
  n int;
BEGIN
  IF v_a IS NULL THEN
    INSERT INTO _proof VALUES ('prerequis', 'N/A : aucune ligne dans whatsapp_instances');
    RETURN;
  END IF;

  -- 1. A lit SES lignes, et seulement les siennes.
  SELECT count(*) INTO n FROM public.whatsapp_instances WHERE user_id <> v_a;
  INSERT INTO _proof VALUES ('1_select_autres_tenants_invisibles', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL (' || n || ' lignes visibles)' END);
  SELECT count(*) INTO n FROM public.whatsapp_instances WHERE user_id = v_a;
  INSERT INTO _proof VALUES ('2_select_ses_lignes', CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL (0 ligne visible)' END);

  -- 3. A tente de réécrire SON instance_name.
  BEGIN
    UPDATE public.whatsapp_instances SET instance_name = 'zrex_proof_hijack' WHERE user_id = v_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO _proof VALUES ('3_update_instance_name_refuse', CASE WHEN n = 0 THEN 'PASS (0 ligne)' ELSE 'FAIL (' || n || ' ligne(s) modifiée(s))' END);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _proof VALUES ('3_update_instance_name_refuse', 'PASS (permission refusée)');
  END;

  -- 4. A tente d'insérer une ligne portant le nom d'une instance de B.
  BEGIN
    INSERT INTO public.whatsapp_instances (user_id, service_type, instance_name)
    VALUES (v_a, 'sav', coalesce((SELECT 'zrex_' || substr(replace(v_b::text, '-', ''), 1, 12) || '_auto'), 'zrex_proof_b_auto'));
    INSERT INTO _proof VALUES ('4_insert_nom_autre_tenant_refuse', 'FAIL (insertion acceptée)');
  EXCEPTION WHEN insufficient_privilege OR unique_violation OR not_null_violation OR check_violation THEN
    INSERT INTO _proof VALUES ('4_insert_nom_autre_tenant_refuse', 'PASS (' || SQLSTATE || ')');
  END;

  -- 5. A tente de supprimer sa ligne.
  BEGIN
    DELETE FROM public.whatsapp_instances WHERE user_id = v_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO _proof VALUES ('5_delete_refuse', CASE WHEN n = 0 THEN 'PASS (0 ligne)' ELSE 'FAIL (' || n || ' ligne(s))' END);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _proof VALUES ('5_delete_refuse', 'PASS (permission refusée)');
  END;
END
$$;

RESET ROLE;
SELECT check_id, resultat FROM _proof ORDER BY check_id;

ROLLBACK;  -- ← toujours : aucune trace en base
