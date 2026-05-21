-- Liste custom de téléphones cibles pour une campagne — alternative au
-- filtrage par statut. Quand cette liste est fournie à la création, le send
-- l'utilise au lieu d'aller chercher dans orders.
--
-- À exécuter dans Supabase → SQL Editor.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS audience_phones TEXT[] DEFAULT NULL;
