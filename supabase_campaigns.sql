-- ============================================
-- ZREXTRACK - Tables campaigns & recipients
-- Exécuter dans Supabase > SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  message_template TEXT NOT NULL,
  audience_status TEXT DEFAULT '',
  status TEXT DEFAULT 'brouillon'
    CHECK (status IN ('brouillon', 'en_cours', 'termine', 'annule')),
  media_url TEXT DEFAULT '',
  total_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  client TEXT NOT NULL,
  phone TEXT NOT NULL,
  tracking TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'en_attente'
    CHECK (status IN ('en_attente', 'envoye', 'echec')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_campaigns" ON campaigns
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_own_recipients" ON campaign_recipients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM campaigns
      WHERE campaigns.id = campaign_recipients.campaign_id
        AND campaigns.user_id = auth.uid()
    )
  );

CREATE POLICY "admin_all_campaigns" ON campaigns FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "admin_all_recipients" ON campaign_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
