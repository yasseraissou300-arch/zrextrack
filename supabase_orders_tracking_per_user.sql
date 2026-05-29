-- ============================================
-- Migration : tracking_number unique par utilisateur
--
-- Avant : orders.tracking_number était UNIQUE globalement. Conséquences :
--   - Deux utilisateurs ne pouvaient pas avoir la même tracking ZRExpress
--     (rare, mais possible si comptes partagés ou refactor).
--   - Le sync ZRExpress de l'utilisateur B pouvait écraser la ligne de
--     l'utilisateur A en cas de collision (onConflict: 'tracking_number'
--     dans /api/sync-zrexpress).
--
-- Après : la contrainte d'unicité devient (user_id, tracking_number).
--   - Chaque utilisateur a son propre espace de tracking.
--   - L'upsert sync utilise onConflict: 'user_id,tracking_number' et ne
--     touchera plus jamais les données d'un autre utilisateur.
--
-- À exécuter dans Supabase > SQL Editor une seule fois.
-- ============================================

-- Étape 1 — détecter et résoudre les doublons éventuels.
-- S'il existe deux lignes avec le même tracking_number et des user_id
-- différents (cas normalement impossible avant cette migration puisque
-- tracking_number était UNIQUE), on garde celle la plus récente.
WITH duplicates AS (
  SELECT id, tracking_number,
         ROW_NUMBER() OVER (
           PARTITION BY tracking_number
           ORDER BY last_update DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM orders
  WHERE tracking_number IS NOT NULL
)
DELETE FROM orders
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Étape 2 — supprimer toutes les anciennes contraintes UNIQUE sur
-- tracking_number (selon le nom donné par Supabase au moment de la
-- création, ça peut être plusieurs noms possibles).
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ~* 'tracking_number'
      -- On ne touche pas à la nouvelle composite si elle est déjà là
      AND pg_get_constraintdef(oid) !~* 'user_id'
  ) LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', c.conname);
  END LOOP;

  -- Suppression des index UNIQUE équivalents au cas où l'unicité serait
  -- enforcée via un index plutôt qu'une contrainte nommée.
  FOR c IN (
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'orders'
      AND indexdef ~* 'UNIQUE'
      AND indexdef ~* 'tracking_number'
      AND indexdef !~* 'user_id'
  ) LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', c.indexname);
  END LOOP;
END $$;

-- Étape 3 — ajouter la contrainte composite.
-- ON CONFLICT (user_id, tracking_number) DO UPDATE sera désormais accepté
-- par PostgREST / supabase-js.
ALTER TABLE orders
  ADD CONSTRAINT orders_user_tracking_uniq UNIQUE (user_id, tracking_number);

-- Étape 4 — index pour accélérer les lookups par tracking pour un user
-- (déjà couvert par la contrainte UNIQUE composite, mais on s'assure d'un
-- index dédié pour les requêtes .eq('user_id', x).eq('tracking_number', y)).
CREATE INDEX IF NOT EXISTS orders_user_tracking_idx
  ON orders(user_id, tracking_number);
