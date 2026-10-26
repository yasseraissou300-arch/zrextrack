-- ============================================================================
-- HUMAN-READONLY-ALL — UNE SEULE exécution couvre 8 actions humaines (2026-10-14)
-- Supabase → SQL Editor du projet de PRODUCTION → coller tel quel → Run.
--
-- 100 % LECTURE SEULE : transaction READ ONLY (PostgreSQL refuse toute écriture)
-- puis ROLLBACK. Aucune valeur secrète, aucun email, aucune donnée client :
-- uniquement des structures (types, contraintes, policies, triggers) et des
-- COMPTAGES. Résultat = une seule grille (check, item, detail) à me renvoyer.
--
-- Tables / colonnes absentes : chaque comptage est protégé (to_regclass +
-- information_schema, requête dynamique via query_to_xml évaluée seulement si
-- la table et la colonne existent) → ligne « table_absente » / « colonne_absente »
-- au lieu d'une erreur qui annulerait toute la grille.
-- Révision 2026-10-15 : comptage intégrations actives sans secret, colonnes
-- RESOLUTION explicites (ABSENTE), 7 champs secrets (#141).
-- ============================================================================
BEGIN TRANSACTION READ ONLY;

WITH
-- ── HUMAN-NOTIF-STATUS-001 (avant #101) : 'sending' accepté ? ───────────────
notif AS (
  SELECT 'NOTIF-STATUS-001'::text AS check_id, 'column_type'::text AS item,
         format_type(a.atttypid, a.atttypmod) AS detail
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.pending_notifications')
    AND a.attname = 'status' AND NOT a.attisdropped
  UNION ALL
  SELECT 'NOTIF-STATUS-001', 'constraint:' || c.conname, pg_get_constraintdef(c.oid)
  FROM pg_constraint c WHERE c.conrelid = to_regclass('public.pending_notifications')
  UNION ALL
  SELECT 'NOTIF-STATUS-001', 'enum:' || t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
  FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE a.attrelid = to_regclass('public.pending_notifications') AND a.attname = 'status'
  GROUP BY t.typname
  UNION ALL
  SELECT 'NOTIF-STATUS-001', 'trigger:' || tgname, pg_get_triggerdef(oid)
  FROM pg_trigger WHERE tgrelid = to_regclass('public.pending_notifications') AND NOT tgisinternal
  UNION ALL
  SELECT 'NOTIF-STATUS-001', 'table_absente', 'public.pending_notifications'
  WHERE to_regclass('public.pending_notifications') IS NULL
),
-- ── HUMAN-SYNCDIFF-TRIGGERS-001 (avant #113) : triggers sur orders ──────────
syncdiff AS (
  SELECT 'SYNCDIFF-TRIGGERS-001', 'trigger:' || tgname, pg_get_triggerdef(oid)
  FROM pg_trigger WHERE tgrelid = to_regclass('public.orders') AND NOT tgisinternal
  UNION ALL
  SELECT 'SYNCDIFF-TRIGGERS-001', 'aucun_trigger', 'OK'
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.orders') AND NOT tgisinternal)
),
-- ── HUMAN-ONCONFLICT-001 (avant #121) : unicité réelle de orders ────────────
onconflict AS (
  SELECT 'ONCONFLICT-001', 'constraint:' || conname, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conrelid = to_regclass('public.orders') AND contype IN ('p','u','x')
  UNION ALL
  SELECT 'ONCONFLICT-001', 'unique_index:' || indexname, indexdef
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'orders' AND indexdef ILIKE '%UNIQUE%'
  UNION ALL
  SELECT 'ONCONFLICT-001', 'backup_table', c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname LIKE 'orders_old_backup%'
),
-- ── HUMAN-INTEGRATIONS-SECRET-001 (avant #120) : comptages uniquement ───────
integ AS (
  SELECT 'INTEGRATIONS-SECRET-001', 'integrations: actives / actives_sans_secret',
         CASE WHEN to_regclass('public.integrations') IS NULL THEN 'table_absente'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'integrations' AND column_name = 'secret_key') THEN 'colonne_absente'
              ELSE substring(query_to_xml($q$SELECT count(*) FILTER (WHERE active) || ' / ' || count(*) FILTER (WHERE active AND coalesce(btrim(secret_key), '') = '') AS c FROM public.integrations$q$, false, false, '')::text FROM '<c>(.*)</c>') END
  UNION ALL
  SELECT 'INTEGRATIONS-SECRET-001', 'voice_call_settings: lignes_avec_jeton',
         CASE WHEN to_regclass('public.voice_call_settings') IS NULL THEN 'table_absente'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'voice_call_settings' AND column_name = 'auth_token') THEN 'colonne_absente'
              ELSE substring(query_to_xml($q$SELECT count(*) FILTER (WHERE coalesce(auth_token, '') <> '') AS c FROM public.voice_call_settings$q$, false, false, '')::text FROM '<c>(.*)</c>') END
),
-- ── HUMAN-ADMIN-CLAIM-001 (avant #115/#122) : qui a le claim ? (ids seulement)
adminclaim AS (
  SELECT 'ADMIN-CLAIM-001', 'profiles_role_admin', count(*)::text
  FROM public.profiles WHERE role = 'admin'
  UNION ALL
  SELECT 'ADMIN-CLAIM-001', 'app_metadata_role_admin', count(*)::text
  FROM auth.users WHERE raw_app_meta_data->>'role' = 'admin'
  UNION ALL
  SELECT 'ADMIN-CLAIM-001', 'admin_profil_SANS_claim:' || p.id::text, 'perdrait l''accès Admin après #115'
  FROM public.profiles p JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'admin' AND coalesce(u.raw_app_meta_data->>'role', '') <> 'admin'
),
-- ── HUMAN-RLS-ROLE-001 : un utilisateur peut-il modifier role/plan_id ? ──────
rlsrole AS (
  SELECT 'RLS-ROLE-001', 'rls_enabled', relrowsecurity::text
  FROM pg_class WHERE oid = to_regclass('public.profiles')
  UNION ALL
  SELECT 'RLS-ROLE-001', 'policy:' || policyname || ' [' || cmd || ']',
         'roles=' || array_to_string(roles, ',') || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-')
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
  UNION ALL
  SELECT 'RLS-ROLE-001', 'grant_update:' || grantee, string_agg(column_name, ',')
  FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'profiles' AND privilege_type = 'UPDATE'
    AND column_name IN ('role','plan_id','status') AND grantee IN ('anon','authenticated')
  GROUP BY grantee
  UNION ALL
  SELECT 'RLS-ROLE-001', 'trigger:' || tgname, pg_get_triggerdef(oid)
  FROM pg_trigger WHERE tgrelid = to_regclass('public.profiles') AND NOT tgisinternal
),
-- ── HUMAN-RESOLUTION-COL-001 : colonnes de ai_chat_sessions ─────────────────
rescol AS (
  SELECT 'RESOLUTION-COL-001', 'column:' || w.col,
         coalesce(c.data_type || ' nullable=' || c.is_nullable, 'ABSENTE')
  FROM (VALUES ('resolution'), ('resolved_at'), ('sheets_sent'), ('relance_sent')) AS w(col)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = 'ai_chat_sessions' AND c.column_name = w.col
),
-- ── HUMAN-004 : secrets encore en clair (COMPTAGES, jamais de valeur) ───────
secrets AS (
  SELECT 'HUMAN-004', 'user_sync_settings.zrexpress_token',
         CASE WHEN to_regclass('public.user_sync_settings') IS NULL THEN 'table_absente'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'user_sync_settings' AND column_name = 'zrexpress_token') THEN 'colonne_absente'
              ELSE substring(query_to_xml($q$SELECT 'clair=' || count(*) FILTER (WHERE zrexpress_token IS NOT NULL AND zrexpress_token <> '' AND zrexpress_token NOT LIKE 'enc:%') || ' chiffre=' || count(*) FILTER (WHERE zrexpress_token LIKE 'enc:%') AS c FROM public.user_sync_settings$q$, false, false, '')::text FROM '<c>(.*)</c>') END
  UNION ALL
  SELECT 'HUMAN-004', 'user_api_credentials.api_key',
         CASE WHEN to_regclass('public.user_api_credentials') IS NULL THEN 'table_absente'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'user_api_credentials' AND column_name = 'api_key') THEN 'colonne_absente'
              ELSE substring(query_to_xml($q$SELECT 'clair=' || count(*) FILTER (WHERE api_key IS NOT NULL AND api_key <> '' AND api_key NOT LIKE 'enc:%') || ' chiffre=' || count(*) FILTER (WHERE api_key LIKE 'enc:%') AS c FROM public.user_api_credentials$q$, false, false, '')::text FROM '<c>(.*)</c>') END
  UNION ALL
  SELECT 'HUMAN-004', 'user_api_credentials.api_secret',
         CASE WHEN to_regclass('public.user_api_credentials') IS NULL THEN 'table_absente'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'user_api_credentials' AND column_name = 'api_secret') THEN 'colonne_absente'
              ELSE substring(query_to_xml($q$SELECT 'clair=' || count(*) FILTER (WHERE api_secret IS NOT NULL AND api_secret <> '' AND api_secret NOT LIKE 'enc:%') || ' chiffre=' || count(*) FILTER (WHERE api_secret LIKE 'enc:%') AS c FROM public.user_api_credentials$q$, false, false, '')::text FROM '<c>(.*)</c>') END
  UNION ALL
  SELECT 'HUMAN-004', 'facebook_connections.page_access_token',
         CASE WHEN to_regclass('public.facebook_connections') IS NULL THEN 'table_absente'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'facebook_connections' AND column_name = 'page_access_token') THEN 'colonne_absente'
              ELSE substring(query_to_xml($q$SELECT 'clair=' || count(*) FILTER (WHERE page_access_token IS NOT NULL AND page_access_token <> '' AND page_access_token NOT LIKE 'enc:%') || ' chiffre=' || count(*) FILTER (WHERE page_access_token LIKE 'enc:%') AS c FROM public.facebook_connections$q$, false, false, '')::text FROM '<c>(.*)</c>') END
  UNION ALL
  SELECT 'HUMAN-004', 'facebook_connections.pending_pages',
         CASE WHEN to_regclass('public.facebook_connections') IS NULL THEN 'table_absente'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'facebook_connections' AND column_name = 'pending_pages') THEN 'colonne_absente'
              ELSE substring(query_to_xml($q$SELECT 'clair=' || count(*) FILTER (WHERE pending_pages IS NOT NULL AND pending_pages <> '' AND pending_pages NOT LIKE 'enc:%') || ' chiffre=' || count(*) FILTER (WHERE pending_pages LIKE 'enc:%') AS c FROM public.facebook_connections$q$, false, false, '')::text FROM '<c>(.*)</c>') END
  UNION ALL
  SELECT 'HUMAN-004', 'integrations.secret_key',
         CASE WHEN to_regclass('public.integrations') IS NULL THEN 'table_absente'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'integrations' AND column_name = 'secret_key') THEN 'colonne_absente'
              ELSE substring(query_to_xml($q$SELECT 'clair=' || count(*) FILTER (WHERE secret_key IS NOT NULL AND secret_key <> '' AND secret_key NOT LIKE 'enc:%') || ' chiffre=' || count(*) FILTER (WHERE secret_key LIKE 'enc:%') AS c FROM public.integrations$q$, false, false, '')::text FROM '<c>(.*)</c>') END
  UNION ALL
  SELECT 'HUMAN-004', 'voice_call_settings.auth_token',
         CASE WHEN to_regclass('public.voice_call_settings') IS NULL THEN 'table_absente'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                               AND table_name = 'voice_call_settings' AND column_name = 'auth_token') THEN 'colonne_absente'
              ELSE substring(query_to_xml($q$SELECT 'clair=' || count(*) FILTER (WHERE auth_token IS NOT NULL AND auth_token <> '' AND auth_token NOT LIKE 'enc:%') || ' chiffre=' || count(*) FILTER (WHERE auth_token LIKE 'enc:%') AS c FROM public.voice_call_settings$q$, false, false, '')::text FROM '<c>(.*)</c>') END
),
-- ── HUMAN-RLS-TENANT-001 : un tenant peut-il réécrire ses lignes sensibles en
--    direct (PostgREST + sa session) ? ex. whatsapp_instances.instance_name
--    pointé vers l'instance d'un autre tenant → le serveur agirait dessus avec
--    la clé Evolution de la plateforme. Structures seulement.
rlstenant AS (
  SELECT 'RLS-TENANT-001', t.tbl || ': rls',
         CASE WHEN to_regclass('public.' || t.tbl) IS NULL THEN 'table_absente'
              ELSE (SELECT relrowsecurity::text FROM pg_class WHERE oid = to_regclass('public.' || t.tbl)) END
  FROM (VALUES ('whatsapp_instances'), ('chatbot_configs'), ('user_sync_settings'),
               ('user_api_credentials'), ('integrations'), ('voice_call_settings'),
               ('facebook_connections')) AS t(tbl)
  UNION ALL
  SELECT 'RLS-TENANT-001', p.tablename || ': policy ' || p.policyname || ' [' || p.cmd || ']',
         'roles=' || array_to_string(p.roles, ',') || ' using=' || coalesce(p.qual, '-') || ' check=' || coalesce(p.with_check, '-')
  FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename IN ('whatsapp_instances', 'chatbot_configs', 'user_sync_settings',
        'user_api_credentials', 'integrations', 'voice_call_settings', 'facebook_connections')
  UNION ALL
  SELECT 'RLS-TENANT-001', g.table_name || ': grant ' || g.grantee, string_agg(DISTINCT g.privilege_type, ',')
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public' AND g.grantee IN ('anon', 'authenticated')
    AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    AND g.table_name IN ('whatsapp_instances', 'chatbot_configs', 'user_sync_settings',
        'user_api_credentials', 'integrations', 'voice_call_settings', 'facebook_connections')
  GROUP BY g.table_name, g.grantee
  UNION ALL
  SELECT 'RLS-TENANT-001', 'whatsapp_instances: hors_motif / noms_partages_entre_tenants',
         CASE WHEN to_regclass('public.whatsapp_instances') IS NULL THEN 'table_absente'
              ELSE substring(query_to_xml($q$SELECT
                (SELECT count(*) FROM public.whatsapp_instances
                  WHERE NOT (instance_name = 'zrex_' || substr(replace(user_id::text, '-', ''), 1, 12)
                     OR instance_name ~ ('^zrex_' || substr(replace(user_id::text, '-', ''), 1, 12) || '_[a-z]+$')))
                || ' / ' ||
                (SELECT count(*) FROM (SELECT instance_name FROM public.whatsapp_instances
                  GROUP BY instance_name HAVING count(DISTINCT user_id) > 1) d) AS c$q$, false, false, '')::text
                FROM '<c>(.*)</c>') END
),
-- ── QUEUE-GRANTS-001 : la file autotim n'est accessible qu'au service_role ──
queuegrants AS (
  SELECT 'QUEUE-GRANTS-001', 'autotim: grants anon/authenticated',
         coalesce((SELECT string_agg(DISTINCT grantee || ':' || privilege_type, ',')
                   FROM information_schema.role_table_grants
                   WHERE table_schema = 'autotim' AND grantee IN ('anon', 'authenticated')), 'aucun (OK)')
  UNION ALL
  SELECT 'QUEUE-GRANTS-001', 'autotim: service_role DELETE sur jobs',
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.role_table_grants
                           WHERE table_schema = 'autotim' AND table_name = 'jobs'
                             AND grantee = 'service_role' AND privilege_type = 'DELETE')
              THEN 'oui (inattendu : 002b ne l''accorde pas)' ELSE 'non (OK)' END
),
-- ── Migrations 006 / 007 : déjà appliquées ? ────────────────────────────────
mig AS (
  SELECT 'MIGRATION-006', 'autotim.webhook_events',
         CASE WHEN to_regclass('autotim.webhook_events') IS NULL THEN 'absente (006 non exécutée)' ELSE 'presente' END
  UNION ALL
  SELECT 'MIGRATION-007', 'profiles_protect_privileged',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profiles_protect_privileged')
              THEN 'presente' ELSE 'absente (007 non exécutée)' END
)
SELECT * FROM notif
UNION ALL SELECT * FROM syncdiff
UNION ALL SELECT * FROM onconflict
UNION ALL SELECT * FROM integ
UNION ALL SELECT * FROM adminclaim
UNION ALL SELECT * FROM rlsrole
UNION ALL SELECT * FROM rescol
UNION ALL SELECT * FROM secrets
UNION ALL SELECT * FROM rlstenant
UNION ALL SELECT * FROM queuegrants
UNION ALL SELECT * FROM mig
ORDER BY 1, 2;

ROLLBACK;
