-- ============================================================================
-- MIGRATION 010 — Comptes employés (autotim.team_members, autotim.activity_log)
-- ----------------------------------------------------------------------------
-- GO explicite du propriétaire le 2026-11-13 (« go » sur la base de données,
-- pour les comptes employés).
--
-- Périmètre : schéma `autotim` UNIQUEMENT (hors de portée de l'autre
-- application qui partage le projet).
--
-- POURQUOI : un marchand veut donner un accès limité à son employé(e) sans
-- partager son compte Google, et savoir qui a fait quoi.
--   team_members : qui est invité / membre de l'espace de quel marchand
--   activity_log : journal des actions (swap, suppression de commande…)
--
-- GARANTIES :
--   - aucune table de `public`, aucun ALTER d'une table existante
--   - AUCUNE modification de auth.users, aucune clé étrangère
--   - 0 instruction destructive (DROP / DELETE / TRUNCATE / UPDATE / INSERT)
--   - idempotente (IF NOT EXISTS) : rejouable sans effet de bord
--   - anon / authenticated : RIEN (REVOKE du schéma de 002 toujours en vigueur)
--   - service_role : SELECT, INSERT, UPDATE — pas de DELETE (une invitation
--     révoquée change de statut, elle n'est pas supprimée)
--
-- Le code fonctionne SANS ces tables : sans elles, personne n'est membre d'une
-- équipe et chaque compte reste propriétaire de son propre espace
-- (comportement d'avant).
--
-- ROLLBACK : aucun n'est nécessaire côté base. Révoquer les membres
-- (status = 'revoked') ou revenir au code précédent suffit.
-- ============================================================================

CREATE TABLE IF NOT EXISTS autotim.team_members (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  owner_id        uuid        NOT NULL,
  email           text        NOT NULL,
  member_user_id  uuid,
  role            text        NOT NULL DEFAULT 'employe',
  status          text        NOT NULL DEFAULT 'invited',
  invited_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  ended_at        timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_members_pkey PRIMARY KEY (id),
  CONSTRAINT team_members_role_chk CHECK (role IN ('employe')),
  CONSTRAINT team_members_status_chk
    CHECK (status IN ('invited', 'active', 'revoked', 'declined', 'left')),
  CONSTRAINT team_members_email_chk
    CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT team_members_active_user_chk
    CHECK (status <> 'active' OR member_user_id IS NOT NULL)
);

COMMENT ON TABLE autotim.team_members IS
  'Employés d''un marchand : invitation par e-mail, acceptée par l''invité. '
  'owner_id = tenant du marchand ; member_user_id = compte de l''employé une fois accepté.';

-- Une seule invitation vivante par (marchand, e-mail).
CREATE UNIQUE INDEX IF NOT EXISTS team_members_owner_email_live_uidx
  ON autotim.team_members (owner_id, email)
  WHERE status IN ('invited', 'active');

-- Un compte appartient à UNE équipe au plus.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_active_user_uidx
  ON autotim.team_members (member_user_id)
  WHERE status = 'active';

-- Recherche des invitations en attente d'un e-mail (à la connexion).
CREATE INDEX IF NOT EXISTS team_members_email_invited_idx
  ON autotim.team_members (email)
  WHERE status = 'invited';

ALTER TABLE autotim.team_members ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seul service_role (BYPASSRLS) y accède.

CREATE TABLE IF NOT EXISTS autotim.activity_log (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  actor_user_id  uuid        NOT NULL,
  actor_email    text        NOT NULL DEFAULT '',
  actor_role     text        NOT NULL DEFAULT 'owner',
  action         text        NOT NULL,
  summary        text        NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_log_pkey PRIMARY KEY (id),
  CONSTRAINT activity_log_action_chk CHECK (char_length(action) BETWEEN 1 AND 64),
  CONSTRAINT activity_log_summary_chk CHECK (char_length(summary) <= 500),
  CONSTRAINT activity_log_role_chk CHECK (actor_role IN ('owner', 'employe'))
);

COMMENT ON TABLE autotim.activity_log IS
  'Journal des actions faites dans l''espace d''un marchand (par lui ou un employé).';

CREATE INDEX IF NOT EXISTS activity_log_tenant_created_idx
  ON autotim.activity_log (tenant_id, created_at DESC);

ALTER TABLE autotim.activity_log ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seul service_role (BYPASSRLS) y accède.

GRANT SELECT, INSERT, UPDATE ON autotim.team_members TO service_role;
GRANT SELECT, INSERT ON autotim.activity_log TO service_role;

-- ----------------------------------------------------------------------------
-- Vérification (read-only) — attendu :
--   anon          | false | false | false | false
--   authenticated | false | false | false | false
--   service_role  | true  | true  | false | true
-- ----------------------------------------------------------------------------
SELECT r.rolname AS role,
       has_table_privilege(r.rolname, 'autotim.team_members', 'SELECT') AS tm_select,
       has_table_privilege(r.rolname, 'autotim.team_members', 'UPDATE') AS tm_update,
       has_table_privilege(r.rolname, 'autotim.team_members', 'DELETE') AS tm_delete,
       has_table_privilege(r.rolname, 'autotim.activity_log', 'INSERT') AS log_insert
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY 1;
