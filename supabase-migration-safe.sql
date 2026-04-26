-- Migration sécurisée : renomme uniquement les colonnes qui existent encore
-- Exécuter dans Supabase > SQL Editor

DO $$
BEGIN
  -- orders : tracking → tracking_number
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='tracking') THEN
    ALTER TABLE orders RENAME COLUMN tracking TO tracking_number;
  END IF;

  -- orders : client → customer_name
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='client') THEN
    ALTER TABLE orders RENAME COLUMN client TO customer_name;
  END IF;

  -- orders : whatsapp → customer_whatsapp
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='whatsapp') THEN
    ALTER TABLE orders RENAME COLUMN whatsapp TO customer_whatsapp;
  END IF;

  -- orders : product → product_name
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='product') THEN
    ALTER TABLE orders RENAME COLUMN product TO product_name;
  END IF;

  -- orders : status → delivery_status
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='status') THEN
    ALTER TABLE orders RENAME COLUMN status TO delivery_status;
  END IF;

  -- messages : tracking → tracking_number
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='tracking') THEN
    ALTER TABLE messages RENAME COLUMN tracking TO tracking_number;
  END IF;

  -- messages : client → customer_name
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='client') THEN
    ALTER TABLE messages RENAME COLUMN client TO customer_name;
  END IF;

  -- messages : whatsapp → customer_whatsapp
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='whatsapp') THEN
    ALTER TABLE messages RENAME COLUMN whatsapp TO customer_whatsapp;
  END IF;
END $$;

-- Index (IF NOT EXISTS pour éviter les doublons)
DROP INDEX IF EXISTS idx_orders_tracking;
DROP INDEX IF EXISTS idx_orders_status;
CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(delivery_status);
CREATE INDEX IF NOT EXISTS idx_messages_tracking_number ON messages(tracking_number);
