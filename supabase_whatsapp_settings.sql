CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  instance_id TEXT NOT NULL DEFAULT '',
  api_token TEXT NOT NULL DEFAULT '',
  connected BOOLEAN DEFAULT false,
  phone TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE whatsapp_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_wa_settings" ON whatsapp_settings
  FOR ALL USING (auth.uid() = user_id);
