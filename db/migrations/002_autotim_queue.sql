-- ============================================================================
-- MIGRATION 002 — Infrastructure de file d'attente AutoTim
-- ----------------------------------------------------------------------------
-- Perimetre : schema `autotim` UNIQUEMENT.
--
-- GARANTIES (verifiables mecaniquement, voir db/migrations/README.md) :
--   - Ne touche AUCUNE table de `public`
--   - Aucun ALTER sur une table preexistante
--   - Aucun DROP, DELETE, TRUNCATE, UPDATE
--   - Aucune cle etrangere (ni vers auth.users, ni vers les tables metier)
--   - Idempotente : rejouable sans effet de bord (IF NOT EXISTS partout)
--
-- CONTEXTE : le projet Supabase est partage avec une autre application qui
-- ecrit dans `public` (Account, Boutique, Commande, Integration, Session,
-- TrackingEvent, User, VerificationToken, WaMessage, WaTemplate) et possede
-- un schema `pattron`. Elle a deja ecrase la table `orders` par le passe.
-- Le schema dedie met ces structures hors de sa portee.
--
-- ROLLBACK : procedure MANUELLE exceptionnelle, documentee dans
-- db/migrations/README.md. Volontairement absente de ce fichier.
-- ============================================================================

-- ─── Schema ──────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS autotim;

COMMENT ON SCHEMA autotim IS
  'Infrastructure AutoTim : file de jobs et reglages par tenant. Isole de public, '
  'partage avec une autre application. Non expose via PostgREST.';

REVOKE ALL ON SCHEMA autotim FROM anon, authenticated;
GRANT USAGE ON SCHEMA autotim TO postgres, service_role;

-- ─── Table : jobs ────────────────────────────────────────────────────────────
-- Contraintes inlinees : ce fichier ne contient aucun ALTER TABLE ... ADD.
CREATE TABLE IF NOT EXISTS autotim.jobs (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  type             text        NOT NULL,
  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status           text        NOT NULL DEFAULT 'pending',
  run_after        timestamptz NOT NULL DEFAULT now(),
  attempts         integer     NOT NULL DEFAULT 0,
  max_attempts     integer     NOT NULL DEFAULT 5,
  locked_at        timestamptz,
  locked_by        text,
  last_error       text,
  idempotency_key  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jobs_pkey PRIMARY KEY (id),

  CONSTRAINT jobs_status_chk
    CHECK (status IN ('pending','running','done','failed','dead')),

  CONSTRAINT jobs_type_chk
    CHECK (type IN ('zrexpress.sync','whatsapp.send','campaign.dispatch')),

  CONSTRAINT jobs_attempts_chk
    CHECK (attempts >= 0 AND max_attempts >= 1 AND attempts <= max_attempts + 1),

  -- Un job 'running' a forcement un verrou ; un job non-'running' n'en a pas.
  -- Empeche un job bloque a jamais en 'running' sans possibilite de reprise.
  CONSTRAINT jobs_locked_coherence_chk
    CHECK ((status = 'running') = (locked_at IS NOT NULL))
);

COMMENT ON TABLE autotim.jobs IS
  'File de jobs. Claim par compare-and-swap (UPDATE ... WHERE id = ? AND status = ''pending'') '
  'depuis /api/cron/tick. Voir src/lib/queue/repository.ts (claimJobs).';
COMMENT ON COLUMN autotim.jobs.tenant_id IS
  'Correspond a auth.users.id. Volontairement SANS cle etrangere : decouplage '
  'du schema gere par Supabase + rollback propre. Scoping assure applicativement.';
COMMENT ON COLUMN autotim.jobs.idempotency_key IS
  'Unique quand non NULL. Garantit qu un meme travail ne s execute qu une fois, '
  'meme si le navigateur et le cron declenchent simultanement.';
COMMENT ON COLUMN autotim.jobs.max_attempts IS
  'whatsapp.send = 1 : ne JAMAIS rejouer un envoi. Un doublon est precisement '
  'ce que l algorithme anti-spam de WhatsApp sanctionne.';

-- ─── Table : tenant_settings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS autotim.tenant_settings (
  tenant_id                 uuid        NOT NULL,
  auto_sync_enabled         boolean     NOT NULL DEFAULT false,
  sync_source               text        NOT NULL DEFAULT 'client',
  last_synced_at            timestamptz,
  consecutive_send_failures integer     NOT NULL DEFAULT 0,
  circuit_open_until        timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_settings_pkey PRIMARY KEY (tenant_id),

  CONSTRAINT tenant_settings_source_chk
    CHECK (sync_source IN ('client','server','both')),

  CONSTRAINT tenant_settings_failures_chk
    CHECK (consecutive_send_failures >= 0)
);

COMMENT ON TABLE autotim.tenant_settings IS
  'Reglages par tenant. Defaut sync_source=client : AUCUN tenant n est bascule '
  'automatiquement par cette migration.';
COMMENT ON COLUMN autotim.tenant_settings.sync_source IS
  'client = navigateur seul | both = transition (idempotence evite le doublon) | '
  'server = cron seul. Le navigateur reste un filet permanent en Phase 1.';
COMMENT ON COLUMN autotim.tenant_settings.circuit_open_until IS
  'Circuit breaker. Session WhatsApp morte = 532 471 lignes d echec observees '
  'en production entre avril et juillet 2026. Ce garde-fou empeche la recidive.';

-- ─── Index ───────────────────────────────────────────────────────────────────
-- Partiels sur les chemins chauds : a 4 tenants, `pending` reste minuscule
-- meme quand `done` accumule des milliers de lignes.

-- Index unique NON partiel, deliberement : en PostgreSQL les NULL sont
-- distincts dans un index unique, donc plusieurs jobs sans cle coexistent
-- sans conflit — comportement identique a un index partiel.
-- Un index partiel casserait ON CONFLICT via PostgREST (la clause WHERE de
-- l'index ne peut pas etre exprimee), et donc l'idempotence elle-meme.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_uniq
  ON autotim.jobs (idempotency_key);

CREATE INDEX IF NOT EXISTS jobs_claim_idx
  ON autotim.jobs (run_after, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS jobs_stale_idx
  ON autotim.jobs (locked_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS jobs_tenant_idx
  ON autotim.jobs (tenant_id, type, status);

CREATE INDEX IF NOT EXISTS jobs_dlq_idx
  ON autotim.jobs (tenant_id, updated_at DESC)
  WHERE status = 'dead';

-- ─── RLS : activee SANS policy ───────────────────────────────────────────────
-- anon et authenticated sont bloques ; service_role passe outre.
-- Meme posture que les tables de l autre application.
-- Ces ALTER portent sur des tables autotim creees ci-dessus, jamais sur public.
ALTER TABLE autotim.jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE autotim.tenant_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- VERIFICATION POST-MIGRATION (lecture seule)
-- Attendu : 2 lignes, rls_enabled = true, policies = 0
-- ============================================================================
SELECT c.relname                                                  AS table_name,
       c.relrowsecurity                                           AS rls_enabled,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'autotim' AND c.relkind = 'r'
ORDER BY c.relname;
