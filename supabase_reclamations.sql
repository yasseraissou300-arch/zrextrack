-- Migration pour le workflow de résolution des réclamations SAV.
-- Ajoute 3 colonnes à ai_chat_sessions :
--   resolution   : type d'action validée par l'opérateur (échange, remboursement, ou résolu sans action)
--   resolved_at  : timestamp de la validation
--   resolved_by  : utilisateur AutoTim qui a validé (pour audit)
--
-- À exécuter dans Supabase → SQL Editor.

ALTER TABLE public.ai_chat_sessions
  ADD COLUMN IF NOT EXISTS resolution TEXT
    CHECK (resolution IS NULL OR resolution IN ('exchange', 'refund', 'resolved')),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index pour lister rapidement les réclamations non résolues
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_unresolved_sav
  ON public.ai_chat_sessions (user_id, updated_at DESC)
  WHERE template_type = 'sav' AND is_complete = true AND resolution IS NULL;
