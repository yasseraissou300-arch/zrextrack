-- ============================================================================
-- PROPOSITION 006 — Rétention de autotim.jobs (P2-8)
-- ----------------------------------------------------------------------------
-- ⛔ NON EXÉCUTÉE. Aucune exécution avant la fin du gel (2026-09-26T22:15Z) ni
--    sans GO explicite. Fichier dans db/proposed/, PAS dans db/migrations/.
--
-- Politique (source de vérité : src/lib/queue/retention.ts, 32 tests) :
--   supprimable UNIQUEMENT
--     - zrexpress.sync  done  depuis > 14 j, clé sync:<tenant>:<créneau> révolue
--     - zrexpress.sync  dead  depuis > 90 j (DLQ conservée 90 j pour audit)
--     - résidus du test d'intégration (tenant réservé 00000000-…-0001,
--       payload.__test__ = true, terminé depuis > 1 j)
--   JAMAIS supprimé, quel que soit l'âge
--     - pending, running (même verrou mort), failed
--     - whatsapp.send et campaign.dispatch, DLQ comprise : leur idempotency_key
--       est la SEULE barrière contre un second message au même client
--       (notif:… si pending_notifications n'a pas été mis à jour, camp:…,
--       campdisp:…). Supprimer la ligne = rouvrir le doublon.
--
-- ÉTAT CONSTATÉ (collecteur 72 h, lecture seule déjà autorisée) : pending,
-- running, dead = 0 ; server_tenants = both_tenants = 0. Aucun sync serveur
-- n'est enfilé aujourd'hui : l'urgence est nulle, la politique est préventive
-- (288 syncs/jour/tenant dès qu'un tenant passe en mode serveur).
--
-- DEUX VOIES D'EXÉCUTION (décision post-gel, HUMAN) :
--   A. scripts/jobs-retention.ts (recommandé : plan, --confirm, vérification)
--      → exige  GRANT DELETE ON autotim.jobs TO service_role;  (section 2).
--        Ce GRANT élargit le privilège de la clé service_role (utilisée par
--        toute l'application) : à peser contre la voie B.
--   B. Section 3 ci-dessous, exécutée par `postgres` dans le SQL Editor,
--      SANS toucher aux privilèges. Se termine par ROLLBACK : il faut
--      remplacer ROLLBACK par COMMIT consciemment, après lecture des comptes.
--
-- PRÉREQUIS dans les deux cas : sauvegarde de autotim.jobs
--   (CREATE TABLE autotim.jobs_backup_AAAAMMJJ AS TABLE autotim.jobs;).
-- ROLLBACK : réinsertion depuis la sauvegarde (les lignes supprimées sont
--   terminales ; aucune n'est réclamable, aucune clé active n'est concernée).
-- ============================================================================


-- ─── 1. APERÇU (lecture seule, toujours sûr) ─────────────────────────────────
SELECT type,
       status,
       count(*)                                          AS total,
       count(*) FILTER (WHERE updated_at < now() - interval '14 days') AS plus_de_14_j,
       count(*) FILTER (WHERE updated_at < now() - interval '90 days') AS plus_de_90_j,
       min(updated_at)                                   AS plus_ancien
FROM autotim.jobs
GROUP BY type, status
ORDER BY type, status;


-- ─── 2. VOIE A — privilège pour le script (DÉCISION, non appliquée) ──────────
-- GRANT DELETE ON autotim.jobs TO service_role;
-- Retour arrière : REVOKE DELETE ON autotim.jobs FROM service_role;


-- ─── 3. VOIE B — suppression par `postgres`, ROLLBACK par défaut ─────────────
BEGIN;

-- Créneau de 5 min courant, identique à syncSlot() (src/lib/queue/idempotency.ts).
CREATE TEMP TABLE _retention_slot ON COMMIT DROP AS
  SELECT floor(extract(epoch FROM now()) / 300)::bigint AS current_slot;

WITH deleted AS (
  DELETE FROM autotim.jobs j
  USING _retention_slot s
  WHERE j.status IN ('done', 'dead')
    AND (
      -- sync terminé / DLQ sync, clé révolue et appartenant bien au tenant
      (
        j.type = 'zrexpress.sync'
        AND (
          j.idempotency_key IS NULL
          -- CASE : l'ordre d'évaluation des AND n'est pas garanti en SQL, le
          -- cast ne doit jamais voir une clé non conforme.
          OR CASE
               WHEN j.idempotency_key ~ '^sync:[^:]+:[0-9]+$'
                AND split_part(j.idempotency_key, ':', 2) = j.tenant_id::text
               THEN split_part(j.idempotency_key, ':', 3)::bigint < s.current_slot - 1
               ELSE false
             END
        )
        AND (
          (j.status = 'done' AND j.updated_at < now() - interval '14 days')
          OR (j.status = 'dead' AND j.updated_at < now() - interval '90 days')
        )
      )
      -- résidus du test d'intégration réel
      OR (
        j.tenant_id = '00000000-0000-4000-8000-000000000001'
        AND j.payload ->> '__test__' = 'true'
        AND j.updated_at < now() - interval '1 day'
      )
    )
  RETURNING j.type, j.status
)
SELECT type, status, count(*) AS supprimes
FROM deleted
GROUP BY type, status
ORDER BY type, status;

-- Contrôle : aucune de ces catégories ne doit apparaître ci-dessus.
--   whatsapp.send | campaign.dispatch | pending | running | failed
-- Comparer le total au plannedDeletes d'une simulation du script du même jour.

ROLLBACK;  -- ← remplacer par COMMIT uniquement sur GO, après lecture des comptes


-- ─── 4. INDEX (optionnel, non nécessaire au volume actuel) ───────────────────
-- Au volume constaté (file vide), un parcours séquentiel est instantané.
-- À envisager au-delà de ~100 000 lignes :
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_retention_idx
--     ON autotim.jobs (type, updated_at) WHERE status IN ('done', 'dead');
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_tenant_recent_idx
--     ON autotim.jobs (tenant_id, updated_at DESC);  -- sert GET /api/jobs
-- (CONCURRENTLY : hors transaction, aucun verrou bloquant sur la file.)
