-- ============================================
-- ZREXTRACK - Table integrations (Shopify, WooCommerce, etc.)
-- Exécuter dans Supabase > SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  platform TEXT NOT NULL,
  identifier TEXT NOT NULL,
  secret_key TEXT DEFAULT '',
  active BOOLEAN DEFAULT true,
  orders_synced INTEGER DEFAULT 0,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- Also add media_url column to campaigns if not already done
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT '';

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_integrations" ON integrations
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admin_all_integrations" ON integrations FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
