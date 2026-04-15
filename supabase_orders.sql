-- ============================================
-- ZREXTRACK - Tables orders & messages
-- Exécuter dans Supabase > SQL Editor
-- ============================================

-- Table orders (commandes ZREXpress)
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking TEXT NOT NULL UNIQUE,
  client TEXT NOT NULL,
  whatsapp TEXT,
  product TEXT,
  wilaya TEXT,
  wilaya_code TEXT,
  status TEXT NOT NULL DEFAULT 'en_preparation'
    CHECK (status IN ('en_preparation','en_transit','en_livraison','livre','echec','retourne')),
  last_update TIMESTAMPTZ DEFAULT NOW(),
  attempts INTEGER DEFAULT 0,
  weight TEXT,
  cod TEXT,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table messages (WhatsApp)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  tracking TEXT,
  client TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'envoye' CHECK (status IN ('envoye','echec','en_attente')),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Policies orders
CREATE POLICY "users_read_own_orders" ON orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_orders" ON orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_orders" ON orders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "admin_all_orders" ON orders FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Policies messages
CREATE POLICY "users_read_own_messages" ON messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_messages" ON messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin_all_messages" ON messages FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
