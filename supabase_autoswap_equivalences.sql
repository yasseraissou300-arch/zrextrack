-- Équivalences de tailles personnalisables par utilisateur pour AutoSwap.
-- Chaque user définit ses propres groupes (ex : Hijab miral → [40/42/44, 46/48/50]).
-- À exécuter dans Supabase → SQL Editor.

CREATE TABLE IF NOT EXISTS public.autoswap_size_equivalences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Clé du produit : SKU normalisé (« mrl », « plin ») OU nameFingerprint
  -- (« hijab miral », « pantalon lain sport »). Le matcher essaie les 2.
  product_key TEXT NOT NULL,
  -- Nom lisible pour la UI (ex « Hijab miral »). Optionnel — fallback sur product_key.
  product_label TEXT,
  -- Tableau de groupes de tailles équivalentes.
  -- Format : [["40","42","44"],["46","48","50"]] pour hijab miral.
  -- Tailles alpha en MAJUSCULES (S/M/L/XL/XXL/XXXL), numériques en string.
  groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, product_key)
);

CREATE INDEX IF NOT EXISTS idx_autoswap_equiv_user
  ON public.autoswap_size_equivalences(user_id);

ALTER TABLE public.autoswap_size_equivalences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "autoswap_equiv_owner" ON public.autoswap_size_equivalences;
CREATE POLICY "autoswap_equiv_owner" ON public.autoswap_size_equivalences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
