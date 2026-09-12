-- ============================================================================
-- 003 — INDEX SUR public
--
--   🚫 NON EXECUTE — ce fichier n'est lance par aucun script.
--   Validation separee requise (checklist D3 / D4).
--
-- Statut au moment de la redaction :
--   D4 (orders)   : OUI, sous reserve de validation du SQL exact  ← ci-dessous
--   D3 (messages) : APRES NETTOYAGE — commente, ne pas decommenter maintenant
--
-- CONTRAINTE TECHNIQUE : CREATE INDEX CONCURRENTLY ne peut PAS s'executer
-- dans un bloc BEGIN/COMMIT. Une commande a la fois, hors transaction.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- D4 — public.orders (user_id, created_at)
-- ────────────────────────────────────────────────────────────────────────────
-- Sert : quota mensuel de plan (src/lib/plan-quotas.ts, countOrdersThisMonth)
--        filtre user_id + created_at >= debut du mois
--
-- Index existants sur orders (mesures) :
--   orders_pkey                  (id) UNIQUE
--   orders_user_tracking_uniq    (user_id, tracking_number) UNIQUE
--   orders_user_tracking_idx     (user_id, tracking_number)
--   idx_orders_user_status_update(user_id, delivery_status, last_update)
--   idx_orders_tracking_number   (tracking_number)
--   idx_orders_delivery_status   (delivery_status)
--   → aucun ne couvre (user_id, created_at)
--
-- IMPACT SUR LA BASE PARTAGEE :
--   Verrous       : CONCURRENTLY ne prend pas de verrou exclusif.
--                   L'autre application n'est jamais bloquee.
--   Duree         : 7 155 lignes / 6,1 Mo → quelques secondes.
--   Stockage      : ~200 ko sur un quota de 500 Mo → negligeable.
--   Autre app     : nul. `orders` est une table AutoTim ; l'autre application
--                   utilise `Commande`.
--   En cas d'echec: laisse un index INVALID a supprimer manuellement.
--   Fenetre       : heure creuse recommandee malgre le faible impact.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_created
  ON public.orders (user_id, created_at DESC);


-- ────────────────────────────────────────────────────────────────────────────
-- D3 — public.messages (user_id, status, sent_at)   ⏸️ REPORTE
-- ────────────────────────────────────────────────────────────────────────────
-- Sert : plafond anti-ban, execute A CHAQUE ENVOI
--        filtre user_id + status='envoye' + sent_at >= now()-24h
--
-- Index existants sur messages (mesures) :
--   messages_pkey                (id) UNIQUE
--   idx_messages_user            (user_id)
--   idx_messages_tracking_number (tracking_number)
--   → le filtre status + sent_at n'est pas couvert
--
-- POURQUOI C'EST REPORTE :
--   messages contient AUJOURD'HUI 532 516 lignes / 210 Mo, dont 532 471 en
--   status='echec' (« Session WhatsApp expiree (Connection Closed) ») pour
--   seulement 45 messages reellement envoyes.
--
--   Creer l'index maintenant reviendrait a indexer 210 Mo de dechet, pour
--   ~15-25 Mo supplementaires sur un quota deja consomme a 42 %.
--
--   Apres nettoyage (~45 lignes restantes), l'index se cree instantanement,
--   pese quelques ko, et devient largement optionnel.
--
--   ➜ ORDRE RECOMMANDE (valide E4) : nettoyage 005 PUIS cet index.
--
-- NE PAS DECOMMENTER AVANT VALIDATION EXPLICITE DE D3.
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_quota
--   ON public.messages (user_id, status, sent_at DESC);


-- ============================================================================
-- CONTROLE — a executer apres CHAQUE CREATE INDEX CONCURRENTLY
-- Aucune ligne ne doit remonter. Si un index INVALID apparait :
--   DROP INDEX CONCURRENTLY <nom>;   puis reessayer.
-- ============================================================================
SELECT i.indexrelid::regclass AS index_name, i.indisvalid
FROM pg_index i
JOIN pg_class c     ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT i.indisvalid;
