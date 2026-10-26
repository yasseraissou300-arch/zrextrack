# AutoTim — Prochaines actions humaines (ordre exact)

> Production = `main` = `7c54428`. Aucun secret ne doit jamais être collé dans un chat. Aucun message vers un client réel.
> Votre copie locale est déjà à `7c54428` : le script `scripts/rewire-whatsapp-webhooks.mjs` est présent.

## 1. WEBHOOK-SECRET-001 (P1)

Avant de commencer, gardez sous la main les valeurs **Production** de `EVOLUTION_API_URL` et `EVOLUTION_API_KEY` (Vercel → Settings → Environment Variables). Elles ne servent que dans **votre** terminal.

- **A.** Dans votre terminal : `openssl rand -hex 32`. Gardez la valeur (gestionnaire de mots de passe).
- **B.** Vercel → Settings → Environment Variables → **Production** → ajouter `WHATSAPP_WEBHOOK_SECRET` = cette valeur.
- **C.** Vercel → Deployments → dernier déploiement de production → **Redeploy**. Attendre « Ready ».
  ⚠️ À partir de ce moment, Evolution envoie encore l'ancienne URL (sans jeton) : les messages entrants sont **refusés jusqu'à l'étape F**. C'est attendu, ce n'est pas une panne. Enchaîner D à F sans attendre.
- **D.** Depuis le dossier `zrextrack` :
  ```bash
  EVOLUTION_API_URL='…' EVOLUTION_API_KEY='…' WHATSAPP_WEBHOOK_SECRET='…' APP_URL='https://autotim.vercel.app' node scripts/rewire-whatsapp-webhooks.mjs
  ```
  Ce premier passage est une **simulation** : aucune écriture. Le jeton n'est jamais affiché (`token=***`).
- **E.** Vérifier l'aperçu : chaque ligne `zrex_…` indique « à recâbler » ; les instances d'autres applications sont « ignorées ».
- **F.** Même commande avec `--apply` à la fin. Attendu : « recâblée » pour chaque instance `zrex_…`, aucun « ÉCHEC ».
- **G.** `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://autotim.vercel.app/api/ai-chatbot/webhook/whatsapp -d '{}'` → **401** (avant : 400).
- **H.** Depuis **votre propre téléphone**, envoyer « Salam » au numéro connecté → le bot répond.

Si H échoue : relancer F. En dernier recours, retirer la variable et redéployer (retour à l'état précédent).

## 2. H-SMOKE

Suivre `docs/AUTOTIM-H-SMOKE.md` (≈ 15 min) :
- connexion, tableau de bord ;
- statut WhatsApp et instance ;
- **un** message vers votre propre numéro, puis sa réception ;
- **une seule** synchronisation ZRExpress, sans la répéter : #113 n'est pas déployée ;
- aucune campagne, aucun client réel.

Transmettre `étape : OK/KO (+ ref)`.

## 3. HUMAN-READONLY-ALL

Supabase → projet de production → SQL Editor → coller `docs/sql/HUMAN-READONLY-ALL.sql` → Run → transmettre la grille.
Lecture seule garantie : `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`. Aucun secret ni email n'apparaît dans le résultat.
Débloque #101, #102, #113, #120 et #121.

## 4. MIGRATION-009 READY FOR HUMAN GO

| Élément | Valeur |
|---|---|
| Fichier | `db/proposed/009_whatsapp_instances_rls.sql` (sur `main`) |
| Effet | `authenticated` = **SELECT de ses lignes uniquement** ; plus aucun INSERT/UPDATE/DELETE client ; `anon` = rien ; `service_role` inchangé (seul écrivain légitime) |
| Hors périmètre | aucune donnée touchée, aucun DROP de table ou colonne, aucun CASCADE, aucune clé étrangère, aucune autre table |
| Idempotence | vérifiée (2ᵉ application identique) |
| Rollback | `db/proposed/009_whatsapp_instances_rls_ROLLBACK.sql` |
| Preuve locale | `node docs/sql/proof-009-pglite.mjs db/proposed docs/sql/MIGRATION-009-PROOF.sql` → AVANT : UPDATE et DELETE **acceptés** (faille) ; APRÈS : tout **refusé** |
| Pré-requis | étapes 1 à 3 OK ; ligne `RLS-TENANT-001 hors_motif / noms_partages` = `0 / 0` |

**Procédure, après votre GO :**
1. Exécuter la section 0 (aperçu) et la lire.
2. Remplacer le `ROLLBACK;` final par `COMMIT;` et exécuter.
3. Exécuter `docs/sql/MIGRATION-009-PROOF.sql` (transaction toujours annulée) → toutes les lignes `PASS`.
4. Refaire les étapes 4, 6 et 8 de H-SMOKE.

## 5. ADMIN-CLAIM-001

Source de vérité (#115 / #122) : **`auth.users.app_metadata.role = 'admin'`**, modifiable uniquement avec la clé `service_role` / SQL. Jamais `profiles.role`.
- **Avant** (lecture) :
  ```sql
  SELECT id, raw_app_meta_data->>'role' FROM auth.users WHERE email = '<votre email>';
  ```
- **Après votre GO** (1 ligne) :
  ```sql
  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
  WHERE id = '<id lu ci-dessus>';
  ```
- Se déconnecter puis se reconnecter : le jeton porte alors le claim.
- Je merge ensuite #115 puis #122 (une PR à la fois), puis migration 007 (avec GO).
- **Vérifications** :
  - votre compte voit Admin ;
  - un compte marchand ne le voit pas ;
  - modifier `profiles.role` via l'API ne donne rien.
- **Rollback** : `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'role' WHERE id = '<id>';`

## 6. FACEBOOK_APP_SECRET (#98, #108)

- **Déjà codé (#98)** : vérification `X-Hub-Signature-256` HMAC-SHA256 avec `FACEBOOK_APP_SECRET`. **Sans** la variable : mode « non appliqué », donc accepté. Le merge de #98 ne casse rien, mais ne protège qu'avec la variable.
- **À vérifier** : Vercel → Environment Variables (Production) : `FACEBOOK_APP_SECRET` **existe-t-elle** ? Ne pas copier la valeur. Elle se trouve dans Meta for Developers → votre app → Paramètres → Général → « Clé secrète ».
- **Ensuite** : je merge #98 puis #108. Contrôle : un POST sans signature sur `/api/ai-chatbot/webhook/facebook` → 401.

## 7. Quand le quota Vercel revient (je m'en charge)

Ordre, une PR à la fois, avec merge → CI → déploiement → smoke → vérification du commit de production :
1. #148
2. #107
3. #147
4. #146
5. #127
6. #128
7. #142
8. #144
9. **#149** (refus si le secret manque en production) — **uniquement après l'étape 1**

Puis fermer #137 et #138, remplacées par #148.

## 8. HUMAN-004 — chiffrement des secrets (après le lot ci-dessus)

1. Générer la clé : `node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"`.
2. Vercel Production : `SECRETS_KEYRING` = cette valeur → Redeploy. Les nouvelles écritures sont chiffrées ; les anciennes valeurs restent lisibles.
3. Sauvegarde : le plan gratuit Supabase n'en fait aucune. GitHub → Actions → « Sauvegarde base de donnees » → **Run workflow** (dump chiffré ; les secrets `SUPABASE_DB_URL` et `BACKUP_PASSPHRASE` doivent exister dans GitHub).
4. Simulation (après GO) :
   ```bash
   npx vite-node --config vitest.config.ts scripts/secrets-backfill.ts -- --target=<ref> --mode=encrypt
   ```
   Elle n'affiche que des comptes.
5. Réel :
   ```bash
   … --apply --backup-confirmed --confirm=<planned>
   ```
   Puis relancer la simulation → `planned = 0`.
6. Optionnel : `SECRETS_REQUIRE_ENCRYPTION=1` (refus de tout nouveau secret en clair).
7. **Rollback** : `--mode=decrypt` avec les mêmes garde-fous.

Ne jamais perdre la clé : sans elle, les valeurs chiffrées deviennent illisibles.
