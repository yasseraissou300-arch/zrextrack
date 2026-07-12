-- Ajoute la colonne pour piloter le warm-up WhatsApp par utilisateur.
-- À exécuter dans Supabase → SQL Editor (une seule fois).
--
-- Sémantique :
--   NULL  → warm-up désactivé, l'utilisateur envoie au plafond normal (40/24h).
--   date  → warm-up actif ; le plafond monte progressivement :
--             J1-3   → 8 msg/24h
--             J4-7   → 15 msg/24h
--             J8-14  → 25 msg/24h
--             J15+   → 40 msg/24h (régime normal atteint, colonne peut être remise à NULL)
--
-- Le user active le warm-up manuellement quand il connecte un nouveau numéro.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS whatsapp_warmup_started_at timestamptz;

-- Recharge le cache PostgREST pour que l'API voie la nouvelle colonne.
NOTIFY pgrst, 'reload schema';
