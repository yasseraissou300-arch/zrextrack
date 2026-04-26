-- =========================================================
-- AI Chatbot — Schema complet (création + migrations)
-- Copiez TOUT ce fichier dans Supabase SQL Editor et cliquez Run
-- =========================================================

-- 1. chatbot_configs
CREATE TABLE IF NOT EXISTS chatbot_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL CHECK (template_type IN ('auto_confirmation', 'sav', 'tracking')),
  is_active BOOLEAN DEFAULT false,
  shop_name TEXT DEFAULT '',
  custom_prompt TEXT DEFAULT '',
  language TEXT DEFAULT 'darija',
  google_sheets_url TEXT DEFAULT '',
  admin_whatsapp TEXT DEFAULT '',
  media_url TEXT DEFAULT '',
  blocked_prefixes TEXT[] DEFAULT '{}',
  human_pause_hours INT DEFAULT 4,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, template_type)
);
ALTER TABLE chatbot_configs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chatbot_configs' AND policyname = 'chatbot_configs_user_isolation'
  ) THEN
    CREATE POLICY "chatbot_configs_user_isolation" ON chatbot_configs FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- Ajouter les colonnes manquantes si la table existait déjà
ALTER TABLE chatbot_configs ADD COLUMN IF NOT EXISTS admin_whatsapp TEXT DEFAULT '';
ALTER TABLE chatbot_configs ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT '';
ALTER TABLE chatbot_configs ADD COLUMN IF NOT EXISTS blocked_prefixes TEXT[] DEFAULT '{}';
ALTER TABLE chatbot_configs ADD COLUMN IF NOT EXISTS human_pause_hours INT DEFAULT 4;

-- 2. whatsapp_instances
CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  instance_name TEXT NOT NULL UNIQUE,
  instance_token TEXT DEFAULT '',
  phone_number TEXT DEFAULT '',
  connected BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_instances' AND policyname = 'whatsapp_instances_user_isolation'
  ) THEN
    CREATE POLICY "whatsapp_instances_user_isolation" ON whatsapp_instances FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- 3. facebook_connections
CREATE TABLE IF NOT EXISTS facebook_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  page_id TEXT DEFAULT '',
  page_name TEXT DEFAULT '',
  page_access_token TEXT DEFAULT '',
  verify_token TEXT DEFAULT '',
  connected BOOLEAN DEFAULT false,
  page_picture TEXT DEFAULT '',
  pending_pages TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE facebook_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'facebook_connections' AND policyname = 'facebook_connections_user_isolation'
  ) THEN
    CREATE POLICY "facebook_connections_user_isolation" ON facebook_connections FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- 4. ai_chat_sessions
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'facebook', 'web')),
  contact_id TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  template_type TEXT DEFAULT 'auto_confirmation',
  conversation JSONB DEFAULT '[]'::JSONB,
  extracted_data JSONB DEFAULT '{}'::JSONB,
  is_complete BOOLEAN DEFAULT false,
  sheets_sent BOOLEAN DEFAULT false,
  human_handover BOOLEAN DEFAULT false,
  failure_count INT DEFAULT 0,
  relance_sent BOOLEAN DEFAULT false,
  human_pause_until TIMESTAMPTZ,
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, channel, contact_id)
);
ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_chat_sessions' AND policyname = 'ai_chat_sessions_user_isolation'
  ) THEN
    CREATE POLICY "ai_chat_sessions_user_isolation" ON ai_chat_sessions FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- Ajouter les colonnes manquantes si la table existait déjà
ALTER TABLE ai_chat_sessions ADD COLUMN IF NOT EXISTS human_handover BOOLEAN DEFAULT false;
ALTER TABLE ai_chat_sessions ADD COLUMN IF NOT EXISTS failure_count INT DEFAULT 0;
ALTER TABLE ai_chat_sessions ADD COLUMN IF NOT EXISTS relance_sent BOOLEAN DEFAULT false;
ALTER TABLE ai_chat_sessions ADD COLUMN IF NOT EXISTS human_pause_until TIMESTAMPTZ;
ALTER TABLE ai_chat_sessions ADD COLUMN IF NOT EXISTS tokens_used INT DEFAULT 0;

-- 5. Index
CREATE INDEX IF NOT EXISTS idx_ai_sessions_user_channel_contact ON ai_chat_sessions(user_id, channel, contact_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_name ON whatsapp_instances(instance_name);
CREATE INDEX IF NOT EXISTS idx_facebook_connections_page ON facebook_connections(page_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_relance ON ai_chat_sessions(is_complete, human_handover, relance_sent, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_pause ON ai_chat_sessions(user_id, channel, contact_id, human_pause_until);
