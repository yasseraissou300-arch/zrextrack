-- ============================================
-- Cross-device sync settings — stocke côté serveur ce qui était
-- précédemment dans localStorage. Garantit que les clés ZRExpress,
-- les templates WhatsApp et les toggles de notifications sont les
-- mêmes pour le même utilisateur sur PC, mobile, navigateur privé,
-- etc.
-- À exécuter dans Supabase > SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS user_sync_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Clés ZRExpress (anciennement localStorage 'zrexpress_token' et 'zrexpress_tenant')
  zrexpress_token TEXT,
  zrexpress_tenant_id TEXT,

  -- Templates WhatsApp par statut (en_transit, en_livraison, livre, echec, retourne)
  templates JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Toggles ON/OFF pour chaque statut
  notify_enabled JSONB NOT NULL DEFAULT '{}'::jsonb,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── RLS — chaque user voit/écrit uniquement ses propres settings ─────────────
ALTER TABLE user_sync_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_sync_settings"   ON user_sync_settings;
DROP POLICY IF EXISTS "users_insert_own_sync_settings" ON user_sync_settings;
DROP POLICY IF EXISTS "users_update_own_sync_settings" ON user_sync_settings;
DROP POLICY IF EXISTS "users_delete_own_sync_settings" ON user_sync_settings;

CREATE POLICY "users_read_own_sync_settings"
  ON user_sync_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_sync_settings"
  ON user_sync_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_own_sync_settings"
  ON user_sync_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_sync_settings"
  ON user_sync_settings FOR DELETE
  USING (auth.uid() = user_id);

-- ─── updated_at automatique ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION user_sync_settings_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_sync_settings_set_updated_at ON user_sync_settings;
CREATE TRIGGER user_sync_settings_set_updated_at
  BEFORE UPDATE ON user_sync_settings
  FOR EACH ROW EXECUTE FUNCTION user_sync_settings_touch_updated_at();
