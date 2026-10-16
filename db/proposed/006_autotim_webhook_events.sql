-- ============================================================================
-- MIGRATION 006 — Anti-rejeu durable des webhooks (autotim.webhook_events)
-- ----------------------------------------------------------------------------
-- 🚫 NON EXÉCUTÉE — préparée pendant le gel de la fenêtre 72 h v2
--    (2026-09-23T22:15Z → 2026-09-26T22:15Z). Exécution sur GO explicite,
--    APRÈS le rapport final, AVANT ou APRÈS le déploiement du code : le code
--    fonctionne sans la table (repli sur le cache mémoire, journalisé).
--
-- Périmètre : schéma `autotim` UNIQUEMENT (hors de portée de l'autre
-- application qui partage le projet).
--
-- POURQUOI : isReplay() (src/lib/security/webhook-auth.ts) garde les
-- identifiants d'événements dans une Map EN MÉMOIRE, locale à une instance
-- Vercel. Un même message WhatsApp livré deux fois par Evolution (retry après
-- une réponse lente — Gemini peut dépasser 10 s — ou ré-émission Baileys à la
-- reconnexion) sur deux instances, ou après un démarrage à froid, passe le
-- filtre : l'IA répond deux fois et deux WhatsApp partent du numéro du
-- marchand.
--
-- GARANTIES :
--   - aucune table de `public`, aucun ALTER d'une table existante
--   - aucune clé étrangère ; idempotente (IF NOT EXISTS)
--   - anon / authenticated : RIEN (REVOKE du schéma de 002 toujours en vigueur)
--   - service_role : SELECT, INSERT, DELETE sur CETTE table seulement.
--     DELETE est une exception assumée à 002b (moindre privilège) : il sert
--     uniquement à la purge des entrées de plus de 7 jours.
--
-- VOLUME : une ligne par message entrant (clé ≤ 200 caractères). Quelques
-- milliers de lignes au plus avec la purge à 7 jours.
--
-- ROLLBACK : DROP TABLE autotim.webhook_events; — le code retombe sur le cache
-- mémoire (comportement actuel), sans erreur.
-- ============================================================================

CREATE TABLE IF NOT EXISTS autotim.webhook_events (
  event_key    text        NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_pkey PRIMARY KEY (event_key),
  CONSTRAINT webhook_events_key_len_chk CHECK (char_length(event_key) BETWEEN 1 AND 200)
);

COMMENT ON TABLE autotim.webhook_events IS
  'Anti-rejeu des webhooks : une ligne par événement déjà traité. '
  'L''INSERT ... ON CONFLICT DO NOTHING est atomique entre instances Vercel. Purge à 7 jours.';

-- Purge : DELETE ... WHERE received_at < now() - interval '7 days'
CREATE INDEX IF NOT EXISTS webhook_events_received_idx
  ON autotim.webhook_events (received_at);

ALTER TABLE autotim.webhook_events ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seul service_role (BYPASSRLS) y accède.

GRANT SELECT, INSERT, DELETE ON autotim.webhook_events TO service_role;

-- ----------------------------------------------------------------------------
-- Vérification (read-only) — attendu :
--   anon          | false | false
--   authenticated | false | false
--   service_role  | true  | true
-- ----------------------------------------------------------------------------
SELECT r.rolname AS role,
       has_table_privilege(r.rolname, 'autotim.webhook_events', 'INSERT') AS can_insert,
       has_table_privilege(r.rolname, 'autotim.webhook_events', 'DELETE') AS can_delete
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY 1;
