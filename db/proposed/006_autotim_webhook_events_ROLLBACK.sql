-- ============================================================================
-- ROLLBACK de la migration 006 — autotim.webhook_events
-- ----------------------------------------------------------------------------
-- 🚫 À n'exécuter que sur GO explicite, et seulement si 006 a été appliquée.
-- Effet : supprime UNIQUEMENT la table d'anti-rejeu (aucune donnée métier).
-- Le code retombe automatiquement sur le cache mémoire par instance
-- (comportement d'avant 006), avec un logEvent 'durable_store_unavailable'.
-- La fenêtre de 7 jours (messageTimestamp) reste appliquée côté code.
-- ============================================================================
BEGIN;
REVOKE ALL ON autotim.webhook_events FROM service_role;
DROP TABLE IF EXISTS autotim.webhook_events;
COMMIT;

-- Vérification (read-only) — attendu : 0 ligne
SELECT to_regclass('autotim.webhook_events') AS table_still_present
WHERE to_regclass('autotim.webhook_events') IS NOT NULL;
