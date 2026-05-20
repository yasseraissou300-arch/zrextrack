-- Ajoute une colonne error_message à la table messages pour stocker la raison
-- d'échec d'un envoi WhatsApp. Permet le diagnostic post-mortem sans avoir
-- besoin de relancer l'envoi pour reproduire l'erreur.
--
-- À exécuter dans Supabase → SQL Editor.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS error_message TEXT;
