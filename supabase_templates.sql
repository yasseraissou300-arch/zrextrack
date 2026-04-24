-- ============================================
-- ZREXTRACK - Table message_templates (Multi-langue)
-- Exécuter dans Supabase > SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  content_darija TEXT DEFAULT '',
  content_arabic TEXT DEFAULT '',
  content_french TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_templates" ON message_templates
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admin_all_templates" ON message_templates FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
