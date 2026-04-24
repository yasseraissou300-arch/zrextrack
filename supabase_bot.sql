-- ============================================
-- ZREXTRACK - Table bot_settings (Bot IA WhatsApp)
-- Exécuter dans Supabase > SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS bot_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) UNIQUE NOT NULL,
  ai_enabled BOOLEAN DEFAULT true,
  language TEXT DEFAULT 'darija' CHECK (language IN ('darija', 'arabic', 'french')),
  system_prompt TEXT DEFAULT '',
  messages_received INTEGER DEFAULT 0,
  ai_replies_sent INTEGER DEFAULT 0,
  tracking_replies_sent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_bot_settings" ON bot_settings
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admin_all_bot_settings" ON bot_settings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
