-- ============================================================================
-- 004 — CORRECTIF RLS : recursion infinie 42P17
--
--   🚫 NON EXECUTE — D1 = PLUS TARD (decision explicite).
--   Conserve HORS du perimetre Phase 1.
--   Contient des DROP POLICY : validation separee + sauvegarde obligatoires.
--
-- La Phase 1 fonctionne SANS ce correctif : les handlers utilisent
-- service_role, qui contourne la RLS.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC (mesure le 2026-09-10 via pg_policies)
-- ────────────────────────────────────────────────────────────────────────────
--
-- CAUSE RACINE — deux policies SUR `profiles` qui interrogent `profiles` :
--
--   profiles_admin_select  (SELECT, roles={public})
--     USING: EXISTS (SELECT 1 FROM profiles p
--                    WHERE p.id = auth.uid() AND p.role = 'admin')
--
--   profiles_admin_update  (UPDATE, roles={public})
--     USING: idem
--
--   Evaluer la policy exige de lire `profiles`, ce qui declenche la policy,
--   qui exige de lire `profiles`... → recursion infinie, erreur 42P17.
--
-- CASCADE — trois policies reproduisent le motif et heritent de la panne :
--
--   orders_select    (SELECT) : auth.uid() = user_id
--                               OR EXISTS (SELECT 1 FROM profiles ...)
--   orders_update    (UPDATE) : idem
--   messages_select  (SELECT) : idem
--
-- SYMPTOME OBSERVE : requete anon sur orders / profiles / messages
--                    → HTTP 500, code 42P17.
--
-- CONSEQUENCE ACTUELLE : l'application ne fonctionne que parce que 48 routes
-- sur 58 utilisent createServiceClient() (bypass RLS). L'isolation entre
-- entreprises repose donc entierement sur le scoping applicatif .eq('user_id').


-- ────────────────────────────────────────────────────────────────────────────
-- PATTERN SAIN — DEJA PRESENT ET FONCTIONNEL DANS CETTE MEME BASE
-- ────────────────────────────────────────────────────────────────────────────
--
-- Trois policies sur `profiles` ne recursent pas, car elles lisent le JETON
-- et non la table :
--
--   admin read all    (SELECT, roles={authenticated})
--   admin update all  (UPDATE, roles={authenticated})
--   admin delete all  (DELETE, roles={authenticated})
--     USING: (auth.jwt() ->> 'email') = 'yasseraissou300@gmail.com'
--
-- VARIANTE PLUS PROPRE (D2 = plus tard) : utiliser une claim de role plutot
-- qu'une adresse en dur --
--     coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
-- Elle evite d'inscrire un email dans le schema, mais suppose de peupler
-- app_metadata.role a la creation de compte.


-- ────────────────────────────────────────────────────────────────────────────
-- SQL PROPOSE — NE PAS EXECUTER SANS VALIDATION EXPLICITE SEPAREE
-- ────────────────────────────────────────────────────────────────────────────
/*

BEGIN;

-- 1) Supprimer les deux policies recursives.
--    Aucune capacite admin n'est perdue : « admin read all » et
--    « admin update all » (pattern JWT) couvrent deja ces acces.
DROP POLICY IF EXISTS profiles_admin_select ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;

-- 2) Casser la cascade sur orders et messages.
DROP POLICY IF EXISTS orders_select   ON public.orders;
DROP POLICY IF EXISTS orders_update   ON public.orders;
DROP POLICY IF EXISTS messages_select ON public.messages;

CREATE POLICY orders_select ON public.orders FOR SELECT
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'yasseraissou300@gmail.com'
  );

CREATE POLICY orders_update ON public.orders FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'yasseraissou300@gmail.com'
  );

CREATE POLICY messages_select ON public.messages FOR SELECT
  USING (
    auth.uid() = user_id
    OR (auth.jwt() ->> 'email') = 'yasseraissou300@gmail.com'
  );

COMMIT;

*/


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICATION APRES APPLICATION (lecture seule)
-- Doivent renvoyer un nombre, et non l'erreur 42P17.
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM public.profiles;
-- SELECT count(*) FROM public.orders;
-- SELECT count(*) FROM public.messages;


-- ────────────────────────────────────────────────────────────────────────────
-- HORS PERIMETRE — signale, non traite
-- ────────────────────────────────────────────────────────────────────────────
-- `public.profiles` porte 12 policies, largement redondantes :
--   profiles_select_own / users read own      → meme regle (auth.uid() = id)
--   profiles_update_own / users update own    → meme regle
--   admin read all / admin update all / admin delete all
--   users insert own, ...
-- Une consolidation serait souhaitable mais depasse le cadre de la Phase 1.
