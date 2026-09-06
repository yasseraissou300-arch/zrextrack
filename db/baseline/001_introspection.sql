-- ============================================================================
-- INTROSPECTION READ-ONLY — à exécuter dans Supabase → SQL Editor
-- ----------------------------------------------------------------------------
-- 100 % lecture seule. Aucun CREATE, ALTER, DROP, INSERT, UPDATE, DELETE.
-- Sert à compléter db/baseline/000_SCHEMA_REEL.md avec les types exacts,
-- les contraintes, les index et les policies RLS — que l'introspection via
-- PostgREST ne peut pas voir.
--
-- Exécuter chaque bloc et coller le résultat dans 000_SCHEMA_REEL.md.
-- ============================================================================

-- ─── 1. COLONNES + TYPES ────────────────────────────────────────────────────
SELECT table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- ─── 2. CONTRAINTES (PK / FK / UNIQUE / CHECK) ──────────────────────────────
SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       kcu.column_name,
       ccu.table_name  AS references_table,
       ccu.column_name AS references_column
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
WHERE tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- ─── 3. INDEX ───────────────────────────────────────────────────────────────
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- ─── 4. POLICIES RLS  ← LE PLUS IMPORTANT ───────────────────────────────────
-- Objectif : identifier la policy récursive sur `profiles`.
-- Chercher une policy dont le USING/WITH CHECK interroge `profiles` lui-même.
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       qual        AS using_expression,
       with_check  AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ─── 5. RLS ACTIVÉE ? ───────────────────────────────────────────────────────
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- ─── 6. TABLES RÉELLEMENT PRÉSENTES ─────────────────────────────────────────
SELECT table_name,
       pg_size_pretty(pg_total_relation_size(quote_ident(table_name)::regclass)) AS size
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ─── 7. VOLUMÉTRIE ORDERS PAR TENANT (dimensionnement) ──────────────────────
SELECT user_id, count(*) AS nb_orders,
       min(created_at) AS premier, max(created_at) AS dernier
FROM orders
GROUP BY user_id
ORDER BY nb_orders DESC;
