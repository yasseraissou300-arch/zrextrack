# AutoTim — Actions humaines restantes (finales)

> Uniquement ce qui ne peut **pas** être fait automatiquement sans risque : lecture de la base de production, écriture en production, secrets, merges, décisions métier.
> Tout le code, les tests, les migrations et les rollbacks correspondants sont **déjà préparés** dans les PR.
> Aucune action ne demande de copier un secret dans le chat.
> État au 2026-10-16 : **32 PR mergées et déployées** (production = `7c54428`), 18 ouvertes — voir `docs/AUTOTIM-PRODUCTION-STATUS.md`.

Ordre recommandé : **1 → 2 → 3**, puis les autres au fil des lots de merge (voir `docs/AUTOTIM-FINAL-STATUS.md`, §12).

---

## 1. HUMAN-READONLY-ALL — une seule lecture de la base de production (≈ 1 min)

- **WHY** — 11 vérifications qui ne peuvent se faire que sur la vraie base. Elles débloquent #143 (P0), #101/#102, #113, #121 et sa chaîne, #120 et #104, et confirment la sécurité de la file et des tables sensibles.
- **EXACT COMMAND** — Supabase → projet **production** → SQL Editor → coller `docs/sql/HUMAN-READONLY-ALL.sql` tel quel → Run → transmettre la grille obtenue.
- **EXPECTED RESULT** (≈ 35 lignes `check_id | item | detail`) :

  | Ligne | Attendu |
  |---|---|
  | `RLS-TENANT-001` `hors_motif / noms_partages` | `0 / 0` |
  | `NOTIF-STATUS-001` | type `text`, aucune contrainte excluant `sending` |
  | `SYNCDIFF-TRIGGERS-001` | `aucun_trigger OK` |
  | `ONCONFLICT-001` | un index ou une contrainte UNIQUE `(user_id, tracking_number)` |
  | `INTEGRATIONS-SECRET-001` | `table_absente`, ou `N / 0` |
  | `ADMIN-CLAIM-001` | 1 identifiant `admin_profil_SANS_claim:<uuid>` (le propriétaire) → action 4 |
  | `RLS-ROLE-001` / `RLS-TENANT-001` | politiques et grants (à analyser) |
  | `QUEUE-GRANTS-001` | `aucun (OK)` / `non (OK)` |
  | `HUMAN-004` | comptes `clair=N chiffre=M` |
  | `MIGRATION-006` / `MIGRATION-007` | `absente` (attendu à ce stade) |

- **RISK** — nul. Transaction `BEGIN TRANSACTION READ ONLY` + `ROLLBACK` : PostgreSQL refuse toute écriture. Seulement des structures et des comptages (aucun email, aucun secret, aucune donnée client). Testé sur deux schémas simulés (PGlite).
- **ROLLBACK** — sans objet (aucune écriture).
- **WHEN TO RUN** — maintenant.
- **DEPENDENCIES** — aucune.

## 2. HUMAN-MERGE-001 — ~~merger #96~~ FAIT (#96 mergée et déployée le 2026-10-15)

- **WHY** — à partir de là, chaque PR passe tsc, lint, tests et build avant merge.
- **EXACT COMMAND** — GitHub → PR #96 → Merge. Ensuite, sur chaque PR à merger : fermer puis rouvrir, ou pousser un commit, pour déclencher la CI.
- **EXPECTED RESULT** — run « CI » vert sur `main`. Le déploiement Vercel est « Ready » sans changement applicatif (seul `.github/` change) ; `/login` répond 200.
- **RISK** — nul. Le workflow utilise `pull_request` (pas `pull_request_target`), `contents: read`, aucun secret, et des actions épinglées par SHA.
- **ROLLBACK** — revert du merge.
- **WHEN TO RUN** — maintenant.
- **DEPENDENCIES** — aucune.

## 3. HUMAN-PROD-DOMAIN-001 et HUMAN-005 — deux lectures dans Vercel

- **WHY**
  - Le domaine sert de base à la preuve « optimiseur d'images servi par Vercel » (#136).
  - `FACEBOOK_APP_SECRET` absent ferait refuser tous les webhooks Messenger après #98.
- **EXACT COMMAND** — Vercel → Project → Domains : `zrextrack.vercel.app` est-il le domaine de production ? Vercel → Settings → Environment Variables (Production) : `FACEBOOK_APP_SECRET`, `WHATSAPP_WEBHOOK_SECRET`, `CRON_TICK_SECRET` **existent-ils** ? Ne copier aucune valeur.
- **EXPECTED RESULT** — oui / oui.
- **RISK** — nul (lecture).
- **ROLLBACK** — sans objet.
- **WHEN TO RUN** — avant le merge de #98 et de #136.
- **DEPENDENCIES** — aucune.

## 3bis. WEBHOOK-SECRET-001 — fermer le webhook WhatsApp entrant (P1, CONSTATÉ en production)

- **WHY** — le 2026-10-15, un `POST /api/ai-chatbot/webhook/whatsapp` sans jeton a répondu **400 « Bad payload »** : l'authentification est en mode « non appliqué », donc **`WHATSAPP_WEBHOOK_SECRET` n'est pas défini**. N'importe qui peut forger un message entrant ; le bot répond alors via l'instance d'un tenant vers un numéro choisi, et consomme du Gemini.
- **EXACT COMMAND**
  1. Dans **votre** terminal : `openssl rand -hex 32` (ou `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Ne jamais coller la valeur dans un chat.
  2. Vercel → Settings → Environment Variables → **Production** → `WHATSAPP_WEBHOOK_SECRET` = cette valeur → Redeploy.
  3. **Dès que le déploiement est « Ready »** (les messages entrants sont refusés jusqu'à l'étape 4) :
     ```bash
     EVOLUTION_API_URL=… EVOLUTION_API_KEY=… WHATSAPP_WEBHOOK_SECRET=… APP_URL=https://autotim.vercel.app node scripts/rewire-whatsapp-webhooks.mjs
     ```
     Lire la simulation, puis relancer la même commande avec `--apply`.
- **EXPECTED RESULT**
  - le script affiche « recâblée » pour chaque instance AutoTim ;
  - `curl -X POST https://autotim.vercel.app/api/ai-chatbot/webhook/whatsapp -d '{}'` → **401** ;
  - un message envoyé au bot depuis votre propre téléphone reçoit une réponse.
- **RISK** — courte interruption des messages entrants entre l'étape 2 et l'étape 3 (quelques minutes). Le script ne touche que les instances `zrex_…`.
- **ROLLBACK** — supprimer la variable dans Vercel et redéployer : le webhook est à nouveau accepté sans jeton, y compris avec les URL déjà recâblées.
- **WHEN TO RUN** — dès que possible, de préférence à une heure creuse.
- **DEPENDENCIES** — aucune (script fusionné : #145).

## 3ter. CRON-SECRET-001 — relances automatiques (comportement changé par #104, déployée)

- **WHY** — `/api/ai-chatbot/relance` acceptait n'importe quel appelant ; c'est corrigé et déployé (#104 : 401 sans authentification). Le mode « planificateur » (toutes les boutiques) exige désormais `CRON_SECRET`. Sans lui, seules les relances déclenchées depuis le tableau de bord (session du marchand) fonctionnent.
- **EXACT COMMAND** — si des relances automatiques sont voulues : générer une valeur comme ci-dessus → Vercel `CRON_SECRET` (Production) → Redeploy → dans cron-job.org, ajouter au job de relance l'en-tête `Authorization: Bearer <valeur>` (méthode POST).
- **EXPECTED RESULT** — le job cron-job.org répond 200 `{"ok":true,"scope":"all"}`.
- **RISK** — aucun ; rollback : retirer la variable.

## 3quater. H-SMOKE — vérification connectée (≈ 15 min, aucune donnée client) — checklist détaillée : `docs/AUTOTIM-H-SMOKE.md`

- **WHY** — les parcours connectés (déployés : #143, #103, #109–#114, #117) ne peuvent être vérifiés qu'avec une session.
- **EXACT COMMAND** — se connecter sur `https://autotim.vercel.app` puis :
  1. tableau de bord, Commandes (pagination), Clients, Livraisons, Rapports ;
  2. Messages → statut WhatsApp « connecté », puis QR (sans rescanner) ;
  3. envoi manuel d'**un** message vers **votre propre numéro** (renvoyer le même message dans la minute : « Déjà envoyé récemment », pas de second message) ;
  4. Synchroniser ZRExpress (bouton) ;
  5. envoyer un message au bot depuis votre téléphone → réponse.
- **EXPECTED RESULT** — tout fonctionne. Toute erreur affiche une référence (`ref`) : la transmettre avec l'heure, jamais une capture contenant des données client.
- **RISK** — un seul message, vers vous-même.
- **WHEN TO RUN** — maintenant.

## 3quinquies. H-QUEUE — 24 h de journaux de la file (#125, #126)

- Vercel → Logs, filtre `queue.` : présence de `queue.tick` réguliers ; absence de rafales (`whatsapp.send` espacés) ; aucun `status: exception` répété.

## 4. ADMIN-CLAIM-001 — poser le claim Super Admin du propriétaire (écriture `auth.users`)

- **WHY** — avec #115, l'accès Admin repose sur `app_metadata.role` (non modifiable par l'utilisateur) et non plus sur `profiles.role` (modifiable). Sans le claim, le propriétaire perd l'accès au panneau Admin.
- **EXACT SQL** :
  ```sql
  -- AVANT (lecture) : l'UUID vient de la grille de l'action 1
  SELECT id, raw_app_meta_data->>'role' AS role FROM auth.users WHERE id = '<UUID>';
  -- MIGRATION (1 ligne)
  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
  WHERE id = '<UUID>';
  -- APRÈS
  SELECT id, raw_app_meta_data->>'role' AS role FROM auth.users WHERE id = '<UUID>';  -- 'admin'
  ```
- **EXPECTED RESULT** — `role = admin` ; après merge et déploiement de #115, le panneau Admin est visible pour le propriétaire seul.
- **RISK** — faible : une ligne, réversible. Le propriétaire doit se reconnecter pour que le jeton porte le claim.
- **ROLLBACK** — `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'role' WHERE id = '<UUID>';`
- **WHEN TO RUN** — juste avant le merge de #115.
- **DEPENDENCIES** — action 1.

## 5. MIGRATION-009 — `whatsapp_instances` en lecture seule pour les tenants (RLS-TENANT-001)

- **WHY** — la politique historique `FOR ALL USING (auth.uid() = user_id)` laisse un tenant réécrire son `instance_name` via PostgREST. #143 ferme le chemin côté application ; 009 le ferme côté base (défense en profondeur).
- **EXACT SQL** — `db/proposed/009_whatsapp_instances_rls.sql` (PR #143) :
  - section 0 = vérification **avant** ;
  - sections 1 à 3 = migration ;
  - section 4 = vérification **après** ;
  - le fichier se termine par `ROLLBACK` : remplacer par `COMMIT` consciemment.
- **EXPECTED RESULT** — une seule politique `whatsapp_instances_select_own [SELECT]` ; `authenticated` = SELECT seul ; `anon` = rien.
- **RISK** — faible : aucune donnée touchée. Toutes les écritures légitimes passent par la clé `service_role`, qui contourne la RLS. Prouvé sur PGlite : réécriture refusée, lecture limitée à ses lignes, idempotente, rollback.
- **ROLLBACK** — `db/proposed/009_whatsapp_instances_rls_ROLLBACK.sql`.
- **WHEN TO RUN** — **après** merge, déploiement et smoke test de #143.
- **DEPENDENCIES** — #143 déployée ; action 1 (`hors_motif = 0`).

## 6. MIGRATION-007 — `profiles` : colonnes privilégiées non modifiables par le client

- **WHY** — empêche un utilisateur de modifier lui-même `role`, `plan_id`, `status` ou `id` (quota illimité, déblocage de compte).
- **EXACT SQL** — `db/proposed/007_profiles_protect_privileged.sql` (PR #115) : trigger `BEFORE UPDATE` qui refuse ces colonnes pour `authenticated` et `anon`. Rollback : `007_profiles_protect_privileged_ROLLBACK.sql`.
- **EXPECTED RESULT** — trigger `profiles_protect_privileged` présent ; une mise à jour de `plan_id` par un utilisateur échoue (42501).
- **RISK** — faible : le service (`service_role`) n'est pas concerné, et les mises à jour du profil par l'utilisateur (nom, avatar) restent possibles.
- **ROLLBACK** — fichier `_ROLLBACK`.
- **WHEN TO RUN** — après #115 et l'action 4.
- **DEPENDENCIES** — actions 1 et 4.

## 7. MIGRATION-006 — anti-rejeu durable des webhooks (optionnelle)

- **WHY** — sans 006, l'anti-rejeu reste en mémoire par instance. Le code de #112 et #121 se dégrade proprement sans elle.
- **EXACT SQL** — `db/proposed/006_autotim_webhook_events.sql` (PR #112). Rollback : `006_autotim_webhook_events_ROLLBACK.sql`.
- **EXPECTED RESULT** — table `autotim.webhook_events` ; la ligne `MIGRATION-006` de l'action 1 passe à `presente`.
- **RISK** — faible : table nouvelle, aucune donnée existante touchée.
- **WHEN TO RUN** — avec le lot de #112.
- **DEPENDENCIES** — aucune.

## 8. ONCONFLICT — seulement si l'action 1 montre le cas B ou C

- **WHY** — #121 fait un upsert sur `(user_id, tracking_number)` et exige une contrainte d'unicité correspondante.
- **EXACT SQL** — préparé **après** lecture du résultat (cas A : aucune migration).
- **WHEN TO RUN** — avant le merge de #121.
- **DEPENDENCIES** — action 1.

## 9. HUMAN-004 — chiffrement des secrets au repos

- **WHY** — les clés ZRExpress, Gemini, Meta, Shopify/Woo et Twilio sont encore en clair (comptes dans l'action 1). Le code de #116, #117, #119 et #120 lit les deux formats (clair et chiffré).
- **EXACT COMMAND**
  1. Vercel → générer `SECRETS_KEYRING="k1:<32 octets base64>"` directement dans Vercel (jamais dans le chat), puis redéployer.
  2. Sauvegarde des 5 tables concernées.
  3. Simulation : `npx vite-node --config vitest.config.ts scripts/secrets-backfill.ts -- --target=<ref> --mode=encrypt`.
  4. Réel : `… -- --target=<ref> --mode=encrypt --apply --backup-confirmed --confirm=<planned de la simulation>` (PR #141).
- **EXPECTED RESULT** — une nouvelle simulation affiche `planned = 0`.
- **RISK** — moyen si la clé est perdue (valeurs illisibles) : la conserver hors de Vercel aussi.
- **ROLLBACK** — `… -- --target=<ref> --mode=decrypt --apply --backup-confirmed --confirm=<N>`.
- **WHEN TO RUN** — après le lot secrets (#116 → #120) et #141.
- **DEPENDENCIES** — actions 1 et 2.

## 10. HUMAN-SHEETS-GLOBAL-001 — feuille Google globale

- **WHY** — avant #135, tous les tenants alimentaient la feuille `GOOGLE_SHEETS_WEBHOOK_URL` de la plateforme.
- **EXACT COMMAND** — Vercel : la variable existe-t-elle ? Si oui, la feuille peut contenir des lignes d'autres tenants : décider de son nettoyage (données historiques).
- **RISK** — confidentialité de données passées.
- **WHEN TO RUN** — après #135.

## 11. Décisions métier (pas de code arbitraire)

| ID | Question | Recommandation | Débloque |
|---|---|---|---|
| ~~DECISION-127~~ | **PRISE le 2026-10-16 : SAFE DEFAULT** (jamais deux fois au même destinataire ; renvoi uniquement par action explicite confirmée). Implémenté par #127 + #128 + #142. Amélioration possible plus tard : figer l'audience au premier lancement | — | #127, #128, #142 (quota Vercel) |
| DECISION-SHEETS-OWNERSHIP | compte de service Google partagé entre tenants (connaître l'ID d'un Sheet suffit pour y écrire) | preuve de propriété (jeton à coller dans le Sheet) | durcissement P3 |
| HUMAN-006 | domaine officiel des liens de suivi | — | liens `/track` |
| HUMAN-LOGS-RETENTION-001 | durée de rétention des journaux Vercel | lecture du plan Vercel | conformité |
