-- ============================================================================
-- MIGRATION 002b — Privilèges de table pour service_role sur `autotim`
-- ----------------------------------------------------------------------------
-- ✅ EXÉCUTÉE le 2026-09-11 sur GO explicite (périmètre : autotim, service_role uniquement).
--
-- Périmètre : schéma `autotim` UNIQUEMENT. Aucune référence à `public`/`auth`.
--
-- CONSTAT (vérification post-002, 2026-09-11) :
--   002 accorde `USAGE` sur le schéma à service_role, mais les tables créées
--   par `postgres` dans un schéma hors `public` n'héritent d'AUCUN privilège :
--     - autotim.jobs            relacl = NULL (propriétaire seul)
--     - autotim.tenant_settings relacl = NULL
--     - pg_default_acl sur autotim : aucune entrée
--   Preuve reproductible dans le SQL Editor :
--     SET ROLE service_role; SELECT count(*) FROM autotim.jobs;
--     → ERROR 42501: permission denied for table jobs
--   Conséquence : `createServiceClient().schema('autotim')` renvoie 42501
--   tant que ces GRANT ne sont pas appliqués. Le code Phase 1 (cron/tick,
--   /api/jobs, /api/sync/preferences) est donc inopérant sans 002b.
--
-- GARANTIES :
--   - 0 DROP / DELETE / TRUNCATE / UPDATE / INSERT / ALTER TABLE
--   - 0 référence à `public.` ou `auth.`
--   - anon et authenticated ne reçoivent RIEN (le REVOKE de 002 reste en vigueur)
--   - Idempotente : GRANT / ALTER DEFAULT PRIVILEGES rejouables sans effet
--   - Rollback : REVOKE symétrique (manuel, non automatisé)
-- ============================================================================

-- Tables existantes (jobs, tenant_settings).
-- DELETE, TRUNCATE, REFERENCES, TRIGGER volontairement exclus : le code Phase 1
-- n'utilise que select / upsert / update (aucun .delete() dans src/lib/queue,
-- src/app/api/cron, src/app/api/jobs, src/app/api/sync). Moindre privilège.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA autotim TO service_role;

-- Tables futures créées par postgres dans autotim (même périmètre).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA autotim
  GRANT SELECT, INSERT, UPDATE ON TABLES TO service_role;

-- ----------------------------------------------------------------------------
-- Vérification (read-only) — attendu :
--   anon          | false | false | false | false
--   authenticated | false | false | false | false
--   service_role  | true  | true  | true  | true
-- ----------------------------------------------------------------------------
SELECT r.rolname AS role,
       has_table_privilege(r.rolname, 'autotim.jobs', 'SELECT')            AS jobs_select,
       has_table_privilege(r.rolname, 'autotim.jobs', 'INSERT')            AS jobs_insert,
       has_table_privilege(r.rolname, 'autotim.tenant_settings', 'SELECT') AS ts_select,
       has_table_privilege(r.rolname, 'autotim.tenant_settings', 'UPDATE') AS ts_update
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY 1;
