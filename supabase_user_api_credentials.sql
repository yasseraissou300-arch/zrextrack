-- ============================================
-- BYOK — Bring Your Own Keys
-- Chaque utilisateur peut stocker ses propres clés API (Gemini, GROQ, Evolution)
-- pour ne pas consommer celles du propriétaire de la plateforme.
-- À exécuter dans Supabase > SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS user_api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 'gemini' | 'groq' | 'evolution' (extensible)
  service TEXT NOT NULL,

  -- Clé API principale (Gemini key, GROQ key, Evolution apikey)
  api_key TEXT,

  -- URL du serveur pour Evolution API uniquement (ex https://evo.mondomaine.com)
  api_url TEXT,

  -- Champ libre pour stocker un secret/instanceId si nécessaire
  api_secret TEXT,

  -- Désactivable sans suppression
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Une seule ligne par (user, service)
  CONSTRAINT user_api_credentials_user_service_uniq UNIQUE (user_id, service),

  -- Garde-fous valeurs autorisées
  CONSTRAINT user_api_credentials_service_chk
    CHECK (service IN ('gemini', 'groq', 'evolution', 'anthropic', 'greenapi'))
);

CREATE INDEX IF NOT EXISTS user_api_credentials_user_idx
  ON user_api_credentials(user_id);

-- ─── RLS — chaque user voit/écrit uniquement ses propres clés ─────────────────
ALTER TABLE user_api_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_credentials"  ON user_api_credentials;
DROP POLICY IF EXISTS "users_insert_own_credentials" ON user_api_credentials;
DROP POLICY IF EXISTS "users_update_own_credentials" ON user_api_credentials;
DROP POLICY IF EXISTS "users_delete_own_credentials" ON user_api_credentials;

CREATE POLICY "users_read_own_credentials"
  ON user_api_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_credentials"
  ON user_api_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_own_credentials"
  ON user_api_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_credentials"
  ON user_api_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- ─── updated_at automatique ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION user_api_credentials_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_api_credentials_set_updated_at ON user_api_credentials;
CREATE TRIGGER user_api_credentials_set_updated_at
  BEFORE UPDATE ON user_api_credentials
  FOR EACH ROW EXECUTE FUNCTION user_api_credentials_touch_updated_at();

-- Note sécurité : les clés sont stockées en clair pour simplifier.
-- RLS empêche un user de lire celles d'un autre, et la table n'est jamais
-- exposée au frontend (les routes serveur lisent via SUPABASE_SERVICE_ROLE_KEY
-- et filtrent par user_id). Pour un chiffrement au repos, voir pgcrypto.
