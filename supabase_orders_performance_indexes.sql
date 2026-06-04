-- ============================================================================
-- Index de performance — table orders (+ messages)
-- ----------------------------------------------------------------------------
-- CONTEXTE : le plan gratuit Supabase tourne sur un compute "Nano" (2 vCPU
-- partagés, 0.5 Go RAM). Les routes /api/kpis (9 COUNT par statut) et
-- /api/stats (lecture de TOUTES les commandes de l'utilisateur) étaient
-- exécutées toutes les 30 s par le tableau de bord. Sans index adapté, chaque
-- requête faisait un "full table scan" → CPU à 86 % → projet "Unhealthy" →
-- erreur 522 (base injoignable). Aucune donnée n'était perdue : juste le
-- serveur saturé.
--
-- Ces index transforment les scans complets en accès indexés. Pour ~4000
-- commandes, la création est instantanée (< 1 s) et ne modifie AUCUNE donnée.
--
-- À exécuter une fois dans : Supabase Dashboard → SQL Editor.
-- ============================================================================

-- Index composite couvrant :
--   • /api/kpis      → COUNT WHERE user_id = ? AND delivery_status = ?
--   • "livrées auj." → ... AND last_update >= today
--   • /api/stats     → SELECT delivery_status, last_update WHERE user_id = ?
--     (index-only scan : toutes les colonnes lues sont dans l'index)
CREATE INDEX IF NOT EXISTS idx_orders_user_status_update
  ON orders (user_id, delivery_status, last_update);

-- Filtre par user seul + tri par date (sécurité pour requêtes sans statut)
CREATE INDEX IF NOT EXISTS idx_orders_user_lastupdate
  ON orders (user_id, last_update);

-- /api/kpis → COUNT messages WHERE user_id = ?
CREATE INDEX IF NOT EXISTS idx_messages_user
  ON messages (user_id);

-- Met à jour les statistiques du planificateur Postgres pour qu'il choisisse
-- bien les nouveaux index.
ANALYZE orders;
ANALYZE messages;
