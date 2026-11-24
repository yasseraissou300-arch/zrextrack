-- ============================================================================
-- MIGRATION 011 — Commandes à confirmer (Google Sheets → WhatsApp → ZRExpress)
-- ----------------------------------------------------------------------------
-- Demandée par le propriétaire le 2026-11-24 (parcours « à la Notify » :
-- commandes du Google Sheet → confirmation WhatsApp → envoi à ZRExpress →
-- messages de suivi → avis du client). GO base de données donné le
-- 2026-11-13 ; exécution par le propriétaire (clic Run).
--
-- Périmètre : schéma `autotim` UNIQUEMENT (hors de portée de l'autre
-- application qui partage le projet).
--
--   order_sources : Google Sheet du marchand + réglages de confirmation
--   inbox_orders  : commandes importées du Sheet, avant ZRExpress
--   wa_prompts    : questions posées au client par WhatsApp (confirmer,
--                   disponibilité le jour de livraison, avis) et sa réponse
--
-- GARANTIES :
--   - aucune table de `public`, aucun ALTER d'une table existante
--   - AUCUNE modification de auth.users, aucune clé étrangère
--   - 0 instruction destructive (DROP / DELETE / TRUNCATE / UPDATE / INSERT)
--   - idempotente (IF NOT EXISTS) : rejouable sans effet de bord
--   - anon / authenticated : RIEN (REVOKE du schéma de 002 toujours en vigueur)
--   - service_role : SELECT, INSERT, UPDATE — pas de DELETE
--
-- Le code fonctionne SANS ces tables : la page « À confirmer » affiche alors
-- un message d'attente, rien d'autre ne change.
-- ============================================================================

CREATE TABLE IF NOT EXISTS autotim.order_sources (
  tenant_id           uuid        NOT NULL,
  sheet_id            text,
  auto_confirm        boolean     NOT NULL DEFAULT false,
  confirm_template    text,
  last_import_at      timestamptz,
  last_import_status  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_sources_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT order_sources_sheet_chk
    CHECK (sheet_id IS NULL OR sheet_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  CONSTRAINT order_sources_template_chk
    CHECK (confirm_template IS NULL OR char_length(confirm_template) <= 1000)
);

COMMENT ON TABLE autotim.order_sources IS
  'Source des commandes à confirmer (Google Sheet partagé avec le compte de service) et réglages.';

ALTER TABLE autotim.order_sources ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS autotim.inbox_orders (
  id               uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid          NOT NULL,
  source           text          NOT NULL DEFAULT 'sheets',
  external_ref     text          NOT NULL,
  customer_name    text          NOT NULL DEFAULT '',
  phone            text          NOT NULL DEFAULT '',
  wilaya           text          NOT NULL DEFAULT '',
  commune          text          NOT NULL DEFAULT '',
  address          text          NOT NULL DEFAULT '',
  product          text          NOT NULL DEFAULT '',
  quantity         integer       NOT NULL DEFAULT 1,
  price            numeric(12,2) NOT NULL DEFAULT 0,
  delivery_type    text          NOT NULL DEFAULT 'domicile',
  note             text          NOT NULL DEFAULT '',
  status           text          NOT NULL DEFAULT 'new',
  confirm_sent_at  timestamptz,
  answered_at      timestamptz,
  zr_tracking      text,
  zr_error         text,
  ordered_at       timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT inbox_orders_pkey PRIMARY KEY (id),
  CONSTRAINT inbox_orders_source_chk CHECK (source IN ('sheets', 'manual')),
  CONSTRAINT inbox_orders_status_chk
    CHECK (status IN ('new', 'confirming', 'confirmed', 'cancelled', 'no_answer', 'sent')),
  CONSTRAINT inbox_orders_delivery_chk CHECK (delivery_type IN ('domicile', 'stopdesk')),
  CONSTRAINT inbox_orders_quantity_chk CHECK (quantity BETWEEN 1 AND 999),
  CONSTRAINT inbox_orders_price_chk CHECK (price >= 0),
  CONSTRAINT inbox_orders_ref_chk CHECK (char_length(external_ref) BETWEEN 1 AND 100),
  CONSTRAINT inbox_orders_sent_chk CHECK (status <> 'sent' OR zr_tracking IS NOT NULL)
);

COMMENT ON TABLE autotim.inbox_orders IS
  'Commandes importées (Google Sheet) avant leur création chez ZRExpress : '
  'new → confirming (WhatsApp envoyé) → confirmed / cancelled / no_answer → sent (colis ZR créé).';

-- Un même ligne du Sheet n'est importée qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS inbox_orders_tenant_ref_uidx
  ON autotim.inbox_orders (tenant_id, external_ref);

-- Tableau par colonne de statut.
CREATE INDEX IF NOT EXISTS inbox_orders_tenant_status_idx
  ON autotim.inbox_orders (tenant_id, status, created_at DESC);

ALTER TABLE autotim.inbox_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS autotim.wa_prompts (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  phone        text        NOT NULL,
  kind         text        NOT NULL,
  ref          text        NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz,
  answer       text,
  handled_at   timestamptz,
  CONSTRAINT wa_prompts_pkey PRIMARY KEY (id),
  CONSTRAINT wa_prompts_kind_chk CHECK (kind IN ('confirm', 'delivery', 'rating')),
  CONSTRAINT wa_prompts_phone_chk CHECK (phone ~ '^[0-9]{8,15}$'),
  CONSTRAINT wa_prompts_ref_chk CHECK (char_length(ref) BETWEEN 1 AND 100),
  CONSTRAINT wa_prompts_answer_chk CHECK (answer IS NULL OR char_length(answer) <= 32)
);

COMMENT ON TABLE autotim.wa_prompts IS
  'Question posée par WhatsApp (réponse par chiffre) : la plus récente sans réponse '
  'd''un numéro décide comment lire « 1 », « 2 », « 3 ».';

-- Dernière question sans réponse d'un numéro (lecture à chaque message entrant).
CREATE INDEX IF NOT EXISTS wa_prompts_open_idx
  ON autotim.wa_prompts (tenant_id, phone, sent_at DESC)
  WHERE answered_at IS NULL;

-- Statistiques (avis) et demandes à traiter (report, changement d'adresse).
CREATE INDEX IF NOT EXISTS wa_prompts_tenant_kind_idx
  ON autotim.wa_prompts (tenant_id, kind, answered_at DESC);

ALTER TABLE autotim.wa_prompts ENABLE ROW LEVEL SECURITY;

-- Aucune policy : seul service_role (BYPASSRLS) accède à ces tables.
GRANT SELECT, INSERT, UPDATE ON autotim.order_sources TO service_role;
GRANT SELECT, INSERT, UPDATE ON autotim.inbox_orders TO service_role;
GRANT SELECT, INSERT, UPDATE ON autotim.wa_prompts TO service_role;

-- ----------------------------------------------------------------------------
-- Vérification (read-only) — attendu :
--   anon          | false | false | false | false
--   authenticated | false | false | false | false
--   service_role  | true  | true  | true  | false
-- ----------------------------------------------------------------------------
SELECT r.rolname AS role,
       has_table_privilege(r.rolname, 'autotim.order_sources', 'UPDATE') AS src_update,
       has_table_privilege(r.rolname, 'autotim.inbox_orders', 'INSERT')  AS inbox_insert,
       has_table_privilege(r.rolname, 'autotim.wa_prompts', 'UPDATE')    AS prompts_update,
       has_table_privilege(r.rolname, 'autotim.inbox_orders', 'DELETE')  AS inbox_delete
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY 1;
