# Sécurité et isolation multi-tenant

## Authentification

- **Middleware** (`src/middleware.ts`) : il vérifie seulement la **présence**
  d'un cookie `sb-*-auth-token`, sans appel réseau, pour éviter les 504 du
  runtime Edge. `/api/*` est public côté middleware : **chaque route
  authentifie elle-même** avec `createClient().auth.getUser()`.
- **Service role** : la plupart des routes lisent et écrivent avec
  `createServiceClient()`, qui contourne la RLS. L'isolation repose donc sur
  `.eq('user_id', user.id)` dans chaque requête. `tests/tenant-isolation.test.ts`
  vérifie statiquement ce scoping et liste les dérogations justifiées :
  suivi public, webhooks, relance planifiée, super admin.

## RLS

La récursion 42P17 casse la RLS sur `orders`, `messages` et `profiles`. Toute
lecture depuis le navigateur renvoie 500 (confirmé le 2026-09-23).

- Correctif SQL : `db/proposed/004_rls_fix_42P17.sql`, non exécuté. Décision
  D1 du propriétaire : « plus tard ».
- Contournement applicatif : branche `p1-rls-pages-via-api`. Les pages
  Alertes, Clients, Livraisons et Rapports lisent via `/api/orders/view`.

## Webhooks et points d'entrée machine

| Point d'entrée                              | Authentification                                                                                                  | État                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `/api/cron/tick`                            | `x-webhook-token` = `CRON_TICK_SECRET`                                                                            | appliquée en production                                        |
| `/api/ai-chatbot/webhook/whatsapp`          | `?token=` = `WHATSAPP_WEBHOOK_SECRET`, sinon `unenforced`                                                         | présence du secret à vérifier (HUMAN-002)                      |
| `/api/ai-chatbot/webhook/facebook`          | aucune → HMAC `X-Hub-Signature-256`                                                                               | corrigé sur `p0-facebook-webhook-signature`                    |
| `/api/ai-chatbot/facebook/oauth` + callback | `state` = base64(user_id) non signé → nonce + cookie httpOnly, identité tirée de la session                       | corrigé sur `p0-facebook-oauth-state`                          |
| `/api/ai-chatbot/relance`                   | `CRON_SECRET` **si défini**, sinon ouvert à tous et sur tous les tenants → Bearer obligatoire ou session (scopée) | corrigé sur `p1-relance-sav-hardening`                         |
| Instances Evolution                         | token d'instance = UUID du marchand → token aléatoire                                                             | corrigé sur `p0-evolution-instance-token` ; rotation HUMAN-003 |

## Anti-rejeu

- `isReplay()` est un cache mémoire par instance Vercel, sur une fenêtre de
  10 min. Il est inefficace entre instances et après un démarrage à froid.
- Branche `p1-durable-replay-guard` : table `autotim.webhook_events`
  (migration 006, non exécutée), `INSERT … ON CONFLICT DO NOTHING`, repli sur
  la mémoire si la table n'existe pas encore.

## Secrets

- En production, dans les variables Vercel : `SUPABASE_SERVICE_ROLE_KEY`,
  `CRON_TICK_SECRET`, `CRON_SECRET`, `WHATSAPP_WEBHOOK_SECRET`,
  `EVOLUTION_API_KEY`, `FACEBOOK_APP_SECRET`, etc. En local, dans
  `.env.local` (gitignoré).
- En clair en base (constat de l'audit Phase 0) :
  `user_sync_settings.zrexpress_token` et `user_api_credentials.api_key/api_secret`
  (clés Gemini BYOK). À chiffrer : backlog.
- Le dépôt est **public**. Les UUID réels de tenants présents dans les tests
  ont été remplacés sur la branche P0, mais ils restent dans l'historique git :
  les traiter comme publics.

## Journalisation

`logEvent()` (`src/lib/security/safe-log.ts`) masque les téléphones
(`maskPhone`) et produit des événements structurés. Environ 37 routes
renvoient encore `error.message` brut au client (backlog P3).
