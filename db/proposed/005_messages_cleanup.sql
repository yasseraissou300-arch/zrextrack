-- ============================================================================
-- 005 — NETTOYAGE DE public.messages
--
--   🚫 AUCUNE SUPPRESSION, AUCUN ARCHIVAGE DANS LA PHASE 1.
--   E1 = OUI  → seule la VERIFICATION (lecture seule) est autorisee.
--   E2 = PLUS TARD (archivage)
--   E3 = PLUS TARD (suppression)
--   E4 = OUI      → ordre recommande : ce nettoyage AVANT l'index D3.
--
--   Les ~532 000 lignes historiques ne doivent pas etre modifiees sans une
--   validation separee et explicite.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- ETAT MESURE (2026-09-10)
-- ────────────────────────────────────────────────────────────────────────────
--
--   Total                532 516 lignes   ~210 Mo   (42 % du quota free 500 Mo)
--   ├── status='echec'   532 471 lignes   ← 99,991 %
--   │     message unique : « Session WhatsApp expiree (Connection Closed)
--   │                        — reconnecte le QR »
--   │     periode        : 2026-04-24 → 2026-07-30
--   └── status='envoye'       45 lignes   ← A CONSERVER ABSOLUMENT
--         periode        : 2026-04-17 → 2026-06-28
--
--   Par tenant :
--     7a74e3ca-…  alicherifoussama1@gmail.com   493 784 lignes    15 envoyes
--     73b8e14c-…  yasseraissou300@gmail.com      38 732 lignes    30 envoyes
--
--   ORIGINE : session WhatsApp morte fin avril, suivie de trois mois de
--   tentatives repetees, chacune ecrivant une ligne d'echec.
--
--   Le circuit breaker introduit en Phase 1 (autotim.tenant_settings
--   .circuit_open_until) empeche la recidive : au-dela de 5 echecs consecutifs,
--   les envois s'arretent 30 minutes et AUCUNE ligne n'est ecrite dans messages.
--
--   Gain attendu du nettoyage : ~200 Mo, soit 40 % du quota liberes.


-- ============================================================================
-- E1 — VERIFICATION  ✅ AUTORISEE (LECTURE SEULE, aucune modification)
-- ============================================================================
--
-- `envoyes_touches` DOIT valoir 0. Sinon : arret immediat et reevaluation.

SELECT
  count(*)                                   AS eligibles,
  count(*) FILTER (WHERE status = 'envoye')  AS envoyes_touches,   -- doit etre 0
  min(sent_at)                               AS plus_ancien,
  max(sent_at)                               AS plus_recent,
  pg_size_pretty(
    (pg_total_relation_size('public.messages'::regclass)
     * count(*)::numeric
     / NULLIF((SELECT count(*) FROM public.messages), 0))::bigint
  )                                          AS espace_estime
FROM public.messages
WHERE status = 'echec'
  AND error_message LIKE '%Session WhatsApp expirée%'
  AND sent_at < now() - interval '30 days';


-- ────────────────────────────────────────────────────────────────────────────
-- CRITERES D'ELIGIBILITE (deliberement conservateurs)
-- ────────────────────────────────────────────────────────────────────────────
-- Une ligne est eligible SI ET SEULEMENT SI :
--   1. status = 'echec'                         — JAMAIS 'envoye'
--   2. error_message correspond au motif de session morte
--   3. sent_at < now() - interval '30 days'
--
-- Les 45 lignes 'envoye' sont HORS PERIMETRE, sans exception :
-- elles alimentent le compteur du plafond anti-ban.


-- ============================================================================
-- E2 — ARCHIVAGE   ⏸️ NON EXECUTE — validation separee requise
-- ============================================================================
/*

-- Archive dans autotim : hors de portee de l'autre application.
CREATE TABLE IF NOT EXISTS autotim.messages_archive_202609
  (LIKE public.messages INCLUDING DEFAULTS);

INSERT INTO autotim.messages_archive_202609
SELECT * FROM public.messages
WHERE status = 'echec'
  AND error_message LIKE '%Session WhatsApp expirée%'
  AND sent_at < now() - interval '30 days';

-- Controle : doit correspondre exactement a `eligibles` mesure en E1.
SELECT count(*) FROM autotim.messages_archive_202609;

*/
--
-- ⚠️ L'archive OCCUPE LE MEME ESPACE DISQUE. Elle ne libere rien tant qu'elle
--    existe. A supprimer apres une retention convenue (30 jours suggeres).
--
--    Alternative si l'espace est critique : exporter en CSV via l'Export du
--    SQL Editor, puis supprimer sans archive en base.


-- ============================================================================
-- E3 — SUPPRESSION PAR LOTS   ⏸️ NON EXECUTE — validation separee requise
-- ============================================================================
/*

-- Lots de 10 000 : evite un verrou long sur une base partagee.
-- A executer en boucle, un lot a la fois, en observant entre chaque.
-- ~54 iterations attendues.
DELETE FROM public.messages
WHERE id IN (
  SELECT id FROM public.messages
  WHERE status = 'echec'
    AND error_message LIKE '%Session WhatsApp expirée%'
    AND sent_at < now() - interval '30 days'
  LIMIT 10000
);

-- Reste a traiter, entre chaque lot :
SELECT count(*) FROM public.messages
WHERE status = 'echec'
  AND error_message LIKE '%Session WhatsApp expirée%'
  AND sent_at < now() - interval '30 days';

-- Apres le dernier lot :
VACUUM (ANALYZE) public.messages;

*/
--
-- ⚠️ VACUUM ordinaire rend l'espace reutilisable PAR LA TABLE mais ne le
--    restitue pas au systeme de fichiers.
--    VACUUM FULL le restitue mais pose un verrou ACCESS EXCLUSIVE :
--    A PROSCRIRE sur une base partagee en heures ouvrees.


-- ============================================================================
-- ROLLBACK
-- ============================================================================
--   Avec archive    : INSERT INTO public.messages
--                     SELECT * FROM autotim.messages_archive_202609;
--   Sans archive    : restauration depuis la sauvegarde chiffree hebdomadaire
--                     (voir GUIDE_SAUVEGARDE.md)
--
--   ➜ SAUVEGARDE MANUELLE OBLIGATOIRE AVANT LE PREMIER LOT.
