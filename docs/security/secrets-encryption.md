# P2-9 — Chiffrement des secrets stockés en clair

_Conception du 2026-09-24, pendant le gel. Rien n'est exécuté ni déployé._

Le rapport vient d'un audit du code (lecture seule). **Aucune valeur réelle**
ne figure ici. Aucune requête n'a été faite en base.

## 1. Inventaire

| Champ                                     | Contenu                                     | Classement                                                                       | Lectures (serveur)                                                                    | Écritures                              | Exposition constatée                                                                                                                      |
| ----------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `user_sync_settings.zrexpress_token`      | clé API ZRExpress du marchand               | **secret critique** : accès complet au compte ZR, y compris l'exécution de swaps | `/api/sync-settings` GET, `/api/onboarding/state` (booléen), handler `zrexpress.sync` | `/api/sync-settings` PUT               | **renvoyée en clair au navigateur** par GET `/api/sync-settings`, puis **renvoyée par le navigateur** dans le corps de 7 routes (voir §2) |
| `user_sync_settings.zrexpress_tenant_id`  | identifiant du compte ZR                    | configuration, non secrète seule                                                 | idem                                                                                  | idem                                   | —                                                                                                                                         |
| `user_api_credentials.api_key` (gemini)   | pool de clés Gemini BYOK (plusieurs lignes) | **secret** : facturation Google du marchand                                      | `getUserCreds` → `resolveGeminiKeys` (webhooks WhatsApp et Facebook, etc.)            | `/api/user-credentials` POST           | GET masqué, mais **8 caractères** visibles (4 premiers + 4 derniers)                                                                      |
| `user_api_credentials.api_secret`         | inutilisé pour Gemini (null)                | secret si renseigné                                                              | `getUserCreds`                                                                        | POST                                   | jamais renvoyé                                                                                                                            |
| `user_api_credentials.api_url`            | URL                                         | configuration                                                                    | —                                                                                     | POST                                   | renvoyée, sans risque                                                                                                                     |
| `facebook_connections.page_access_token`  | jeton de page Facebook longue durée         | **secret critique** : écrire au nom de la page, lire les conversations           | webhook Messenger (réponses)                                                          | callback OAuth, POST sélection de page | —                                                                                                                                         |
| `facebook_connections.pending_pages`      | JSON des pages **avec leurs jetons**        | **secret** (le JSON entier)                                                      | GET et POST `/api/ai-chatbot/facebook`                                                | callback OAuth                         | jetons renvoyés au navigateur → corrigé sur `p2-facebook-tokens`                                                                          |
| `facebook_connections.verify_token`       | jeton de la poignée de main Meta            | secret de protocole, faible après P0-1                                           | webhook GET (**recherche par égalité**)                                               | callback                               | affiché au marchand (voulu)                                                                                                               |
| `whatsapp_settings.api_token`             | jeton Meta WhatsApp Cloud                   | secret, **mais table absente de l'inventaire de base** (à vérifier)              | `/api/sync-zrexpress` (envoi Meta, chemin hérité)                                     | aucune écriture dans le code           | —                                                                                                                                         |
| `whatsapp_instances.instance_token`       | UUID du marchand, puis vide (P0-3)          | **non secret** : pas une valeur à chiffrer, jamais utilisée                      | —                                                                                     | création d'instance                    | —                                                                                                                                         |
| `voice_call_settings.*`, `integrations.*` | Twilio, Shopify, WooCommerce                | secrets potentiels                                                               | code présent                                                                          | code présent                           | **tables inexistantes en production** (PGRST205) : hors périmètre ; toute création devra passer par `secret-box`                          |

Secrets hors base, gérés comme variables Vercel et **hors périmètre** :
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_TICK_SECRET`, `CRON_SECRET`,
`WHATSAPP_WEBHOOK_SECRET`, `EVOLUTION_API_KEY`, `FACEBOOK_APP_SECRET`.

### Journaux et erreurs

- Aucun `console.*` ni `logEvent` ne contient de valeur secrète. Les logs Gemini
  n'affichent que des indices de clé (« clé 2/3 »).
- Les erreurs PostgREST renvoyées (`error.message`) ne contiennent pas de
  valeurs : le détail « Failing row contains » est dans `details`, qui n'est
  pas renvoyé.
- La clé Gemini passe dans l'URL (`?key=`), comme l'impose l'API Google. Aucun
  log ne reprend cette URL.

## 2. Constat principal : le chiffrement au repos ne suffit pas pour ZRExpress

Aujourd'hui, le jeton ZR fait l'aller-retour par le navigateur :

```
GET /api/sync-settings ──► { zrexpress_token: "<clair>" } ──► état React de 6 pages
                                                             └─► corps JSON de :
  /api/sync-zrexpress, /api/autoswap/{preview,diagnostic,execute,swapped-stats},
  /api/campaigns/delivered-customers, /api/ai-chatbot/reclamations/lookup
```

Chiffrer la colonne sans changer ce flux ne sert à rien : la route GET la
déchiffrerait pour la renvoyer. **La phase 1 doit donc aussi rendre le jeton
strictement serveur.**

- GET renvoie `zrexpress_configured` et une version masquée.
- Les 7 routes lisent le jeton en base pour le tenant de la session.
- Le jeton fourni dans le corps n'est accepté que pour l'essai de connexion
  de la page Sync, avant enregistrement.

Constats voisins, corrigés ou notés :

- `/api/sync-zrexpress` acceptait les appels **sans session**, ce qui insérait
  des lignes orphelines. Corrigé sur `p1-sync-requires-auth`.
- `/api/autoswap/preview` et `/diagnostic` acceptent les appels anonymes. Ce
  n'est qu'un relais en lecture vers ZR avec le jeton de l'appelant, sans
  donnée AutoTim : P3.

## 3. Modèle de menace : ce que le chiffrement protège

| Scénario                                                                                           | Protégé ?                                      |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Fuite d'une sauvegarde ou d'un export de la base (`db-backup`, exports CSV du SQL Editor)          | **oui**                                        |
| **Autre application du même projet Supabase** (elle écrit dans `public` et a déjà écrasé `orders`) | **oui** : elle ne détient pas la clé           |
| Fuite de `SUPABASE_SERVICE_ROLE_KEY` seule                                                         | **oui**                                        |
| Lecture par le marchand de SES propres lignes via la RLS                                           | sans objet (ce sont ses valeurs)               |
| Compromission du runtime Vercel (variables d'environnement)                                        | non : hors de portée du chiffrement applicatif |

## 4. Architecture retenue

Module : `src/lib/security/secret-box.ts`, prêt et testé sur la branche
`claude/p2-secret-box`.

| Sujet               | Choix                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Algorithme          | AES-256-GCM (Node `crypto`, aucune dépendance) ; IV aléatoire de 96 bits par valeur ; tag de 128 bits                                                                                                                           |
| Clé maître          | `SECRETS_KEYRING="<kid>:<base64 32 octets>[,<kid>:<base64>…]"`. La **première** clé chiffre, toutes déchiffrent                                                                                                                 |
| Format stocké       | `enc:v1:<kid>:<iv>:<chiffré+tag>` (base64url). Préfixe `enc:` qui distingue du clair ; version pour une évolution future                                                                                                        |
| Liaison au contexte | AAD = `table.colonne:<id de ligne>`. Une valeur copiée dans la ligne d'un autre tenant ou dans une autre colonne **ne se déchiffre pas**                                                                                        |
| Clair historique    | toute valeur sans préfixe est lue telle quelle (`legacy: true`) : **les credentials existants restent utilisables**                                                                                                             |
| Double chiffrement  | impossible : `seal()` renvoie telle quelle une valeur déjà préfixée                                                                                                                                                             |
| Clé absente         | écriture : clair (comportement actuel), sauf `SECRETS_REQUIRE_ENCRYPTION=1` qui fait échouer. Lecture d'une valeur chiffrée : `SecretError('no_keyring')`, que la route traite comme « non configuré », sans plantage ni fuite  |
| Erreurs             | `SecretError(code, contexte)`. Codes : `no_keyring`, `bad_keyring`, `unknown_key`, `bad_format`, `auth_failed`. **Jamais** de valeur ni de clé dans le message                                                                  |
| Rotation            | ajouter `k2` **en tête** du trousseau ; les valeurs `k1` restent lisibles (`stale: true`) et `reseal()` les ré-écrit en `k2` ; on retire `k1` seulement quand **aucune** valeur `k1` ne reste (compte par préfixe `enc:v1:k1:`) |
| Masquage            | `maskSecret()` : jamais plus des 4 derniers caractères                                                                                                                                                                          |
| Schéma              | **aucune migration SQL** : les colonnes `text` actuelles reçoivent la valeur préfixée. Rien ne change dans `public`                                                                                                             |

Deux limites assumées :

- `verify_token` reste en clair : il sert de **clé de recherche par égalité**,
  ce qui est incompatible avec un IV aléatoire. Si besoin, on stockerait plus
  tard un HMAC.
- Une vraie valeur secrète commençant par `enc:` serait prise pour une valeur
  chiffrée et signalée `bad_format`. Aucun format connu ne le fait : ZR,
  `AIza…`, `EAA…`.

## 5. Environnements

| Environnement       | Trousseau                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production (Vercel) | trousseau de production, généré **par le propriétaire** (HUMAN-004)                                                                                                                                                                           |
| Preview (Vercel)    | ⚠️ **à vérifier** : les previews pointent-elles vers la **même** base Supabase ? Si oui, il faut soit le **même** trousseau que la production, soit **aucun** trousseau. Une clé différente écrirait des valeurs illisibles par la production |
| Local               | clé propre dans `.env.local` (gitignoré). Si la base locale est la base de production, même règle que pour Preview                                                                                                                            |
| Tests               | clés aléatoires générées à l'exécution, jamais de clé fixe dans le dépôt                                                                                                                                                                      |

Génération d'une clé, par le propriétaire, sur sa machine. La valeur n'est
jamais collée ailleurs que dans Vercel :

```
node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"
```

## 6. Migration contrôlée

Chaque phase est une PR distincte, après le gel, dans l'ordre suivant.

| Phase | Contenu                                                                                                                                                                                                                                                                                                                                  | Données touchées                         | Retour arrière                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0     | `secret-box` et tests (cette branche)                                                                                                                                                                                                                                                                                                    | aucune                                   | —                                                                                                                    |
| 1     | lectures via `open()` (tolérantes au clair), écritures via `sealForStorage()` ; jeton ZR **strictement serveur** (§2) ; masquage Gemini sur 4 caractères. **Sans `SECRETS_KEYRING`, comportement identique à aujourd'hui**                                                                                                               | aucune (sans trousseau)                  | redéployer la version précédente                                                                                     |
| 2     | HUMAN-004 : `SECRETS_KEYRING` défini en Production (et selon le §5 pour Preview). Les **nouvelles** écritures sont chiffrées ; les anciennes valeurs restent en clair et lisibles                                                                                                                                                        | nouvelles écritures seulement            | ⚠️ ne **pas** retirer le trousseau tant que des valeurs `enc:` existent ; retour arrière = script inverse (phase 3b) |
| 3     | script `scripts/secrets-backfill.mjs`, lancé à la main sur GO et après une sauvegarde fraîche. **Simulation par défaut.** Pour chaque ligne : `reseal`, contrôle aller-retour **avant** écriture, puis écriture conditionnelle `.eq(colonne, ancienne_valeur)` (pas d'écrasement concurrent). Le rapport ne contient que des **comptes** | valeurs historiques, une ligne à la fois | 3b : mode `--decrypt` symétrique, qui restaure le clair avec le trousseau, puis sauvegarde                           |
| 4     | `SECRETS_REQUIRE_ENCRYPTION=1` ; alerte sur toute lecture `legacy`                                                                                                                                                                                                                                                                       | aucune                                   | retirer la variable                                                                                                  |

**Invariants de migration**

- Aucune valeur n'est supprimée ni remplacée tant que son chiffré ne s'est pas
  relu correctement.
- La clé qui a servi à chiffrer ne quitte **jamais** le trousseau tant qu'une
  valeur l'utilise.
- Le déploiement d'un code antérieur à la phase 1 est **interdit** après la
  phase 2 : il lirait `enc:…` comme un jeton. Il faut d'abord exécuter la
  phase 3b.

## 7. Tests

Écrits sur `claude/p2-secret-box` (21 tests) :

- chiffrement du clair et relecture de la valeur d'origine ;
- IV aléatoire ;
- pas de double chiffrement ;
- Unicode et valeurs longues ;
- mauvaise clé, autre tenant (AAD), valeur altérée, clé retirée, format
  illisible, trousseau mal formé : chaque cas renvoie un `SecretError`
  typé, et un contrôle vérifie que **ni le secret ni la clé** ne figurent
  dans le message ou la pile ;
- trousseau absent : refus de chiffrer, refus de lire une valeur chiffrée,
  écriture en clair en déploiement progressif, et échec si le chiffrement est
  exigé ;
- lecture du clair historique et migration par `reseal`, qui est idempotent ;
- rotation k1 → k2, puis retrait de k1 ;
- masquage sur 4 caractères au plus ;
- **aucune écriture console** pendant les échecs.

À écrire en phase 1 :

- réponses de `/api/sync-settings` et `/api/user-credentials` sans secret ;
- les 7 routes ZR fonctionnent sans jeton dans le corps ;
- lecture de valeurs migrées par le webhook Messenger et `resolveGeminiKeys` ;
- valeur illisible → « non configuré », sans erreur 500 ;
- le script de migration en simulation n'écrit rien.

## 8. Actions humaines associées

- **HUMAN-004**, après le gel et le merge de la phase 1 :
  - générer le trousseau (commande du §5) ;
  - le définir dans Vercel Production ;
  - indiquer si les Previews utilisent la même base Supabase.
- **Décision** : exécution de la phase 3 (backfill) sur GO, après sauvegarde.
