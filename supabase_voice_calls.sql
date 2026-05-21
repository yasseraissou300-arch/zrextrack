-- Module AI Voice Calling — confirmation automatique des commandes par appel.
-- À exécuter dans Supabase → SQL Editor.

-- ── Paramètres Twilio + template de message par utilisateur ────────────────
CREATE TABLE IF NOT EXISTS public.voice_call_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_sid TEXT,
  auth_token TEXT,
  from_number TEXT,         -- ex « +15551234567 » (numéro Twilio acheté)
  shop_name TEXT DEFAULT 'notre boutique',
  -- Template darija avec placeholders {name} {amount} {tracking}
  message_template TEXT DEFAULT 'Marhba {name}, hada call men {shop_name}. Bach tconfirmi commande dyalek b {amount} dinar, taba3 wahed. Bach tlghi, taba3 jouj.',
  -- Voix Polly Twilio (Arabic Neural disponible)
  voice TEXT DEFAULT 'Polly.Hala-Neural',
  -- Texte de confirmation/annulation joué après la touche
  confirm_text TEXT DEFAULT 'Chokran! Commande dyalek tta3la9at, ghadi twasel.',
  cancel_text  TEXT DEFAULT 'Chokran 3la l-rad. Commande dyalek tatlghat.',
  no_answer_text TEXT DEFAULT 'Smahli, ma fhmtish ljawab. Chokran.',
  enabled BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.voice_call_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "voice_call_settings_owner" ON public.voice_call_settings;
CREATE POLICY "voice_call_settings_owner" ON public.voice_call_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Journal des appels passés ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tracking_number TEXT,
  customer_name TEXT,
  customer_phone TEXT NOT NULL,
  amount NUMERIC,
  twilio_call_sid TEXT UNIQUE,
  -- Statut télécom (queued | ringing | in-progress | completed | busy | failed | no-answer | canceled)
  status TEXT,
  -- Outcome métier : ce que le client a fait
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('confirmed', 'cancelled', 'no_answer', 'no_response', 'failed')),
  duration_seconds INT,
  -- Coût estimé en DA (basé sur durée × tarif Twilio Algérie)
  cost_da NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_voice_calls_user_created ON public.voice_calls(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_calls_sid ON public.voice_calls(twilio_call_sid);

ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "voice_calls_owner" ON public.voice_calls;
CREATE POLICY "voice_calls_owner" ON public.voice_calls
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
