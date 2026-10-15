# AUTOTIM FINAL STATUS

> Généré le 2026-10-15 depuis l'état réel du dépôt (`git`, `gh`, exécutions de tests).
> Statuts utilisés : **PASS**, **FAIL**, **UNKNOWN**, **BLOCKED**, **N/A**.
> Niveaux de preuve : **LOCAL PASS** (tests / fusion d'essai), **PREVIEW PASS** (déploiement Vercel de la PR), **PRODUCTION UNKNOWN**, **PRODUCTION PASS / FAIL**.

## 1. Executive Summary

- **48 PR ouvertes (#96 → #143).** Aucune mergée, aucune déployée. `main` distant = `9c2b249`.
- **Fusion d'essai des 48 branches** (≠ merge réel) :
  - 0 conflit ;
  - `tsc` 0 ;
  - **1024/1024 tests** ;
  - `next build` OK, `tsc` 0 après le build ;
  - lint 0 erreur (134 avertissements, tous antérieurs).
- Tous les P0/P1 identifiés ont un **correctif écrit et testé** : RLS-TENANT-001 (#143), Next 15.5.28 (#136), SSRF via Evolution (#137/#138), etc.
- **Aucun n'est en production.** Le niveau de preuve est **LOCAL PASS + PREVIEW PASS** ; la production est **UNKNOWN** tant que les merges, les déploiements et la lecture SQL n'ont pas eu lieu.

## 2. What Was Fixed (code prêt, NON mergé)

| Domaine | Correctif | PR |
|---|---|---|
| **P0 instance WhatsApp d'un autre tenant** | contrôle de propriété (`zrex_<12 hex>[_suffixe]`) avant chaque appel Evolution (13 chemins) et au routage entrant ; inventaire statique ; migration 009 (RLS SELECT seul) préparée | #143 (+ intégré dans #101 #102 #104 #112 #121 #130 #131 #137 #138 #139) |
| Next.js | 15.1.11 → **15.5.28** (RCE AVIF, RCE SVG GHSA-2464, contournement middleware, DoS) | #136 |
| SSRF Sheets / média | garde SSRF (IPv4/IPv6 privées, métadonnées, `*.internal`, DNS, redirections) ; **média : Evolution ne télécharge plus jamais une URL de tenant** (stockage propre transmis, le reste via proxy serveur en base64, 16 Mo, types média) | #137, #138 |
| Google Sheets | feuille globale réservée au Super Admin ; append Sheets réel par compte de service | #135, #138 |
| Envoi manuel WhatsApp | anti-doublon (sélection et 10 min), circuit breaker du tenant, journal | #103 |
| Relance | circuit breaker du tenant respecté ; portée par marchand, plafond, sans rafale | #104 |
| Erreurs | **0 message d'exception brut** dans les réponses API (vérifié sur l'état combiné) | #123 #124 #139 #129 |
| Admin | autorité = `app_metadata.role` (jamais `profiles.role`) ; 007 préparée | #115 #122 |
| Secrets | secret-box AES-256-GCM (AAD liée au tenant et à la colonne, trousseau versionné) ; clé ZR côté serveur ; jetons Meta, Shopify/Woo et Twilio chiffrés ; backfill préparé | #116 #117 #119 #120 #141 |
| Webhooks | signature Meta, state OAuth, Twilio signé obligatoire et `cid` inconnu → 404, HMAC Shopify/Woo, anti-rejeu durable (006) | #98 #99 #134 #120 #112 #121 |
| File / WhatsApp | prise atomique, espacement, reprise 5xx de la passerelle, prise de notification, circuit breaker sur le drain | #101 #102 #125 #126 |
| Synchro / commandes | diff (0 écriture si identique), stats, pagination, pages via API | #109 #110 #111 #113 #114 |
| HTTP | en-têtes, CSP Report-Only + anti-flood, CSRF sur qr/status | #100 #133 #105 |
| CI | tsc, lint, tests, build ; actions épinglées par SHA | #96 |
| Rétention | jobs (008), jamais exécutée | #140 |

## 3. What Was Tested

| Commande | Résultat | Niveau |
|---|---|---|
| `npm test` (fusion d'essai des 48 branches) | **PASS** — 70 fichiers, 1024 tests | LOCAL |
| `npm run type-check` | **PASS** — 0 erreur | LOCAL |
| `npm run lint` | **PASS** — 0 erreur, 134 avertissements antérieurs | LOCAL |
| `npm run build` | **PASS** | LOCAL |
| CI GitHub (#96, run sur `d07db38`) | **PASS** | PREVIEW |
| Vercel Preview (48 PR) | **PASS** | PREVIEW |
| `npm run test:integration` | **BLOCKED** — 12 tests ignorés : cible `AUTOTIM_INTEGRATION_TARGET` absente (volontaire : aucun accès base sans cible explicite) | — |
| RLS / contraintes / triggers réels | **BLOCKED** — tests sur une base simulée (FakeSupabase) ; la production se vérifie par `docs/sql/HUMAN-READONLY-ALL.sql` | — |
| Migration 009 (PGlite) | **PASS** — refus d'écriture, lecture limitée, idempotence, rollback | LOCAL |
| SQL lecture seule (PGlite, 2 schémas) | **PASS** — 35 lignes, aucune fuite de valeur, aucune écriture | LOCAL |

Matrice de couverture (fichiers de test sur l'état combiné) :

- **Sécurité**
  - isolation : `tenant-isolation`, `whatsapp-instance-ownership` ;
  - admin : `admin-role-claim`, `quota-admin-claim` ;
  - rejeu : `replay-store`, `webhooks-durable-replay` ;
  - CSRF : `csrf-whatsapp-qr-status` ;
  - SSRF : `safe-outbound`, `media-url`, `media-delivery` ;
  - secrets : `secret-box`, `stored-secrets`, `api-response-secrets-audit` ;
  - détournement d'instance : `whatsapp-instance-ownership`, `handler-whatsapp-send`.
- **WhatsApp**
  - doublons et crash : `handler-whatsapp-send-claim`, `send-spacing-and-claim`, `idempotency` ;
  - circuit breaker : `circuit-breaker` ;
  - quota et warm-up : `whatsapp-antispam`, `whatsapp-send-route` ;
  - reprises : `gateway-retry`, `backoff`.
- **Commandes** : `orders-list-hardening`, `orders-reclassify-deleted`, `sync-diff-writes` (2 500 commandes, passage identique → 0 écriture), `sync-diff-fields`.
- **Campagnes** : `campaign-phone-key`, `campaign-relaunch`, `handler-campaign-dispatch`.
- **Base de données** : `jobs-retention`, `secret-backfill`, `script-guard` ; migration 009 (PGlite).
- **Auth** : `sync-requires-auth`, `admin-role-claim`, `facebook-oauth-state`.

## 4. Security Status

| Contrôle | Code (LOCAL) | Production |
|---|---|---|
| Isolation tenant (instances WhatsApp) | PASS (#143) | UNKNOWN (RLS réelle : SQL) |
| Isolation tenant (pages, API) | PASS (aucune lecture navigateur hors son propre profil) | UNKNOWN |
| Admin / escalade | PASS (#115, #122) | BLOCKED (claim + 007) |
| Webhooks (signature, rejeu) | PASS | UNKNOWN (secrets présents ? HUMAN-005) |
| CSRF / clickjacking / en-têtes | PASS | UNKNOWN |
| SSRF | PASS (proxy média, garde à chaque saut) | UNKNOWN |
| Secrets (navigateur, journaux, erreurs) | PASS (`NEXT_PUBLIC_*` = URL + clé anon ; 0 `.message` brut) | UNKNOWN |
| Secrets au repos | prêt (#116 → #120, #141) | BLOCKED (HUMAN-004) |

## 5. WhatsApp Status

| Chemin d'envoi | Tenant | Propriété de l'instance | Quota / warm-up | Circuit | Idempotence |
|---|---|---|---|---|---|
| File `whatsapp.send` (notifications, campagnes) | job | ✅ | ✅ à l'envoi | ✅ | ✅ clé + prise atomique |
| Drain de la synchro | session | ✅ | ✅ | ✅ (#102) | ✅ prise atomique |
| Envoi manuel | session | ✅ | ✅ | ✅ lot + tenant (#103) | ✅ anti-doublon 10 min |
| Relance | session / planificateur | ✅ | ✅ | ✅ (#104) | ✅ `relance_sent` |
| Résolution SAV | session | ✅ | **N/A** (1 message par action humaine) | — | ✅ prise atomique |
| Réponses du chatbot / alerte admin | webhook signé | ✅ propriétaire du nom | **N/A** (réponse à un message entrant) | — | ✅ anti-rejeu |

**Production : UNKNOWN.** Le dernier relevé de production date de la mesure 72 h (septembre).

## 6. Database Status

| Élément | État |
|---|---|
| `autotim` (jobs, tenant_settings) | PASS (fichiers) : RLS active, aucun accès `anon` / `authenticated`, `service_role` sans DELETE. Production : UNKNOWN (ligne `QUEUE-GRANTS-001`) |
| `public` | **non modifié** par cette mission |
| Migrations préparées, **non exécutées** | 006 (#112), 007 (#115), 008 (#140), 009 (#143) : chacune avec rollback |
| Exécutées | aucune |

## 7. Scheduler Status

- **Code : PASS** — `POST /api/cron/tick` protégé par `CRON_TICK_SECRET` (le GET ne renvoie qu'une sonde constante) ; budget d'environ 25 s ; reprise des verrous morts ; DLQ ; reprise 5xx de la passerelle (#125).
- **cron-job.org** : job 8441022 actif au dernier relevé ; **état actuel : UNKNOWN**.

## 8. Production Status

| Élément | Statut |
|---|---|
| PR mergées | 0 |
| Déployées | 0 |
| Vérifiées en production | 0 |
| Production actuelle | `main` = `9c2b249` (next 15.1.11) — **PRODUCTION UNKNOWN** pour tous les correctifs ci-dessus |

## 9. PR Status

| Classe | PR |
|---|---|
| A — merge après CI | #96, #97, #99, #100, #103, #105, #106, #107, #109, #110, #111, #114, #116, #117, #118, #119, #123, #124, #125, #129, #132, #133, #134, #135, #139, #140, #141 |
| B — vérification humaine préalable | #98, #108 (HUMAN-005) ; #101, #102 (NOTIF-STATUS) ; #104 (RESOLUTION-COL) ; #113 (SYNCDIFF) ; #115, #122 (ADMIN-CLAIM) ; #120 (INTEGRATIONS-SECRET) ; #126 (seule, surveillance de la file) ; #136 (seule) ; **#143 (seule, `hors_motif = 0`)** |
| C — décision métier | #127, #128, #142 |
| D — migration / GO production | #112 (006), #121 → #130 → #131 → #137 → #138 (ONCONFLICT) |

Dépendances : les PR qui contiennent #143 (§2) doivent être mergées **après** elle. Les piles #101→#102, #115→#122, #123→#124/#139, #125→#126→#127→#128→#142, #100→#133 et #131→#137→#138 sont à jour avec leur base.

## 10. Remaining Human Actions

Voir `docs/AUTOTIM-HUMAN-ACTIONS-FINAL.md`, dans l'ordre :

1. **HUMAN-READONLY-ALL** (lecture seule, ≈ 1 min, débloque 9+ PR).
2. Merger #96.
3. Vérifications Vercel (domaine, présence des secrets).
4. ADMIN-CLAIM-001 (1 ligne).
5. MIGRATION-009.
6. MIGRATION-007.
7. MIGRATION-006 (optionnelle).
8. ONCONFLICT (si cas B ou C).
9. HUMAN-004 (chiffrement des secrets).
10. Feuille globale.
11. Décisions métier.

## 11. Remaining Risks

| Niveau | Risque |
|---|---|
| **P0** | RLS-TENANT-001 **ouvert en production** tant que #143 n'est pas déployée (exploitabilité selon la politique réelle → SQL) |
| P1 | production en next 15.1.11 (optimiseur d'images servi par Vercel : PROUVÉ par en-tête, sous réserve de HUMAN-PROD-DOMAIN-001) ; tous les correctifs P1 non déployés |
| P2 | secrets en clair au repos (HUMAN-004) ; feuille globale historique ; anti-rejeu non durable avant 006 |
| P3/P4 | compte de service Google partagé (connaître l'ID d'un Sheet suffit) ; avis `postcss` (build seulement) ; rebinding résiduel du **proxy serveur** (Vercel, sans réseau interne exploitable) |

## 12. Exact Next Steps

1. Exécuter `docs/sql/HUMAN-READONLY-ALL.sql`, transmettre la grille.
2. Merger **#96** → CI verte sur `main` → Vercel « Ready ».
3. Merger **#136 seule** → déploiement → smoke : `/login`, dashboard, `/track/<n>`, webhook WhatsApp de test, journal `cron/tick`.
4. Si `hors_motif = 0` : merger **#143 seule** → smoke : statut WhatsApp, QR, 1 envoi manuel à soi-même, 1 message entrant → **puis MIGRATION-009**.
5. Lots suivants, chacun avec merge → CI → déploiement → smoke → vérification production :
   - #100 → #133, #105, #106, #132, #134, #135 ;
   - #123 → #124 → #139, #129, #109, #110, #111, #114, #118, #103 ;
   - #116 → #117 → #119 → #97 → #99 ;
   - une par une avec leur vérification : #115 → #122, #98 → #107 → #108, #101 → #102, #113, #120, #104 ;
   - #125 → #126 ;
   - #140, #141 ;
   - (006) #112 → (ONCONFLICT) #121 → #130 → #131 → #137 → #138 ;
   - après décision : #127 → #128 → #142.

## 13. Final Verdict

**READY WITH HUMAN ACTIONS** — pour le **code**.

Tous les correctifs P0/P1 sont écrits, testés (LOCAL PASS), compatibles entre eux (fusion d'essai des 48 branches) et validés en preview. Les migrations ont leur rollback.

**La production n'est PAS prête** : aucune de ces corrections n'est mergée ni déployée, et la faille P0 RLS-TENANT-001 y reste ouverte jusqu'au déploiement de #143 (et de 009). Statut production : **NOT READY / UNKNOWN** jusqu'aux actions 1 à 5.
