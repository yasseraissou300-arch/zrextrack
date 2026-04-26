-- =========================================================
-- AI Chatbot Feature Additions
-- Run in Supabase SQL Editor
-- =========================================================

-- 1. New fields in chatbot_configs
ALTER TABLE chatbot_configs
  ADD COLUMN IF NOT EXISTS blocked_prefixes   TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS admin_whatsapp     TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_url          TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS human_pause_hours  INT     DEFAULT 4;

-- 2. New fields in ai_chat_sessions
ALTER TABLE ai_chat_sessions
  ADD COLUMN IF NOT EXISTS human_pause_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tokens_used        INT     DEFAULT 0;

-- 3. Index to speed up pause check
CREATE INDEX IF NOT EXISTS idx_ai_sessions_pause ON ai_chat_sessions(user_id, channel, contact_id, human_pause_until);
