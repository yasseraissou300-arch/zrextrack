-- =========================================================
-- AI Chatbot Module — Tables & RLS
-- Run in Supabase SQL Editor
-- =========================================================

-- 1. Chatbot template configurations (one per template type per user)
CREATE TABLE IF NOT EXISTS chatbot_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL CHECK (template_type IN ('auto_confirmation', 'sav', 'tracking')),
  is_active BOOLEAN DEFAULT false,
  shop_name TEXT DEFAULT '',
  custom_prompt TEXT DEFAULT '',
  language TEXT DEFAULT 'darija',
  google_sheets_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, template_type)
);
ALTER TABLE chatbot_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chatbot_configs_user_isolation" ON chatbot_configs
  FOR ALL USING (auth.uid() = user_id);

-- 2. WhatsApp instances (Evolution API) — one per user
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
CREATE POLICY "whatsapp_instances_user_isolation" ON whatsapp_instances
  FOR ALL USING (auth.uid() = user_id);

-- 3. Facebook page connections — one per user
CREATE TABLE IF NOT EXISTS facebook_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  page_id TEXT DEFAULT '',
  page_name TEXT DEFAULT '',
  page_access_token TEXT DEFAULT '',
  verify_token TEXT DEFAULT '',
  connected BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE facebook_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "facebook_connections_user_isolation" ON facebook_connections
  FOR ALL USING (auth.uid() = user_id);

-- 4. Chat sessions — persistent conversation state per contact
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, channel, contact_id)
);
ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_chat_sessions_user_isolation" ON ai_chat_sessions
  FOR ALL USING (auth.uid() = user_id);

-- Index for fast webhook lookups
CREATE INDEX IF NOT EXISTS idx_ai_sessions_user_channel_contact ON ai_chat_sessions(user_id, channel, contact_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_name ON whatsapp_instances(instance_name);
CREATE INDEX IF NOT EXISTS idx_facebook_connections_page ON facebook_connections(page_id);
