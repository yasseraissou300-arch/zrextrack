-- ============================================================================
-- Setup complet pour les Campagnes WhatsApp avec audience custom
-- ============================================================================
-- Ce script est IDEMPOTENT : tu peux l'exécuter même si les tables existent
-- déjà. Il crée ce qui manque, ajoute la colonne audience_phones dans tous
-- les cas, et fixe les policies RLS.
--
-- À exécuter dans Supabase → SQL Editor.

-- ── 1. Tables (créées si manquantes) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  client TEXT NOT NULL,
  phone TEXT NOT NULL,
  tracking TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'en_attente'
    CHECK (status IN ('en_attente', 'envoye', 'echec')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Nouvelle colonne audience_phones (cible custom de la PR #41) ───────
-- Liste de téléphones quand la campagne vise une sélection manuelle (ex :
-- clients livrés sélectionnés dans l'explorateur ZRExpress).
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS audience_phones TEXT[] DEFAULT NULL;

-- ── 3. RLS owner-scoped ───────────────────────────────────────────────────
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_campaigns" ON public.campaigns;
CREATE POLICY "users_own_campaigns" ON public.campaigns
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_recipients" ON public.campaign_recipients;
CREATE POLICY "users_own_recipients" ON public.campaign_recipients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE campaigns.id = campaign_recipients.campaign_id
        AND campaigns.user_id = auth.uid()
    )
  );

-- ── 4. Index utiles ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_campaigns_user_created
  ON public.campaigns(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign
  ON public.campaign_recipients(campaign_id);
