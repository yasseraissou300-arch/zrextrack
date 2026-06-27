-- ============================================================================
-- File d'attente des notifications WhatsApp automatiques (anti-ban)
-- ----------------------------------------------------------------------------
-- Au lieu d'envoyer toutes les notifs d'un coup pendant le sync (burst =
-- suspension WhatsApp), chaque changement de statut est mis EN FILE ici, puis
-- envoyé au compte-gouttes (quelques-uns par sync, espacés, sous le plafond
-- journalier) via le numéro Evolution connecté.
--
-- À exécuter une fois dans Supabase → SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pending_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  tracking_number TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  customer_name TEXT,
  customer_whatsapp TEXT,
  wilaya TEXT,
  product_name TEXT,
  cod NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

-- Un changement (numéro de suivi + statut) ne génère qu'UNE notif (pas de
-- doublon, et on ne re-notifie pas un statut déjà notifié).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_notif
  ON pending_notifications (user_id, tracking_number, delivery_status);

-- Pour drainer rapidement les plus anciens en attente.
CREATE INDEX IF NOT EXISTS idx_pending_notif_drain
  ON pending_notifications (user_id, status, created_at);

ALTER TABLE pending_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_pending_notif" ON pending_notifications;
CREATE POLICY "users_own_pending_notif" ON pending_notifications
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
