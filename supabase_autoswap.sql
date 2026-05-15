-- ============================================
-- AutoTim — Migration AutoSwap
-- Exécuter dans Supabase > SQL Editor
-- ============================================

-- 1. Table d'audit autoswap_log
CREATE TABLE IF NOT EXISTS autoswap_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_tracking TEXT NOT NULL,
  target_tracking TEXT NOT NULL,
  product_variant_id TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('EXACT', 'STRONG', 'WEAK')),
  same_city BOOLEAN,
  estimated_savings NUMERIC,
  zr_response JSONB,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  user_id UUID REFERENCES auth.users(id),
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autoswap_log_user      ON autoswap_log(user_id);
CREATE INDEX IF NOT EXISTS idx_autoswap_log_status    ON autoswap_log(status);
CREATE INDEX IF NOT EXISTS idx_autoswap_log_executed  ON autoswap_log(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_autoswap_log_source    ON autoswap_log(source_tracking);

-- RLS
ALTER TABLE autoswap_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_swaps"   ON autoswap_log;
DROP POLICY IF EXISTS "users_insert_own_swaps" ON autoswap_log;
DROP POLICY IF EXISTS "admin_all_swaps"        ON autoswap_log;

CREATE POLICY "users_read_own_swaps"
  ON autoswap_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_swaps"
  ON autoswap_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admin_all_swaps"
  ON autoswap_log FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 2. Étendre les statuts livraison sur la table orders
-- Note : le CHECK existant sur orders.status n'est pas étendu ici par défaut, car la migration
-- exacte dépend du nom de la contrainte créée par le projet. Décommenter et adapter au besoin :
--
--   ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
--   ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_status_check;
--   ALTER TABLE orders ADD CONSTRAINT orders_delivery_status_check
--     CHECK (delivery_status IN (
--       'en_preparation','en_transit','en_livraison','livre','echec','retourne',
--       'swap_redirected','swap_shipped'
--     ));

-- 3. Vue dashboard : économies cumulées par jour
CREATE OR REPLACE VIEW autoswap_savings_daily AS
SELECT
  user_id,
  date_trunc('day', executed_at) AS day,
  COUNT(*) FILTER (WHERE status = 'success') AS swaps_count,
  COALESCE(SUM(estimated_savings) FILTER (WHERE status = 'success'), 0) AS total_savings
FROM autoswap_log
GROUP BY user_id, date_trunc('day', executed_at)
ORDER BY day DESC;
