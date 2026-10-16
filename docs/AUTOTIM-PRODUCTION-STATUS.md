# AutoTim — État de production

> Mis à jour le 2026-10-16 (≈ 02:00 UTC). Production = `https://autotim.vercel.app` (alias `zrextrack.vercel.app`, même déploiement).
> **`main` = production = `7c54428`**, vérifié via l'environnement GitHub « Production ».
> Smoke « public » : `/`, `/login`, `/track`, `/api/health` → 200 ; `/admin-dashboard` → 307 vers `/login` ; `/api/orders` → 401.
> Les parcours **connectés** n'ont pas été testés (aucune session disponible) : **PRODUCTION UNKNOWN**, à vérifier par l'action H-SMOKE.

## Mergées et déployées (32)

| PR | STATUS | DEPLOY | SMOKE TEST | DEPENDENCY | BLOCKER |
|---|---|---|---|---|---|
| #96 CI | MERGED | DEPLOYED `230c156` | PASS : CI verte sur main | — | — |
| #136 Next 15.5.28 | MERGED | DEPLOYED `31b5b7f` | **PASS : `"15.5.28"` servi en production** ; optimiseur d'images servi par Vercel | — | — |
| #143 instance WhatsApp (P0) | MERGED | DEPLOYED `f023f7a` | PASS public (routes WhatsApp → 401 sans session) ; comportement connecté UNKNOWN | 009 | migration 009 (GO) |
| #104 relance | MERGED | DEPLOYED `246eefc` | **PASS : `POST`/`GET /api/ai-chatbot/relance` sans authentification → 401** (avant : 200, exécution pour tous les tenants) | — | CRON-SECRET-001 pour les relances automatiques |
| #145 script de recâblage | MERGED | DEPLOYED `f7ba1da` | N/A (script local) | — | WEBHOOK-SECRET-001 |
| #100 en-têtes | MERGED | DEPLOYED `e1e4f49` | **PASS : XFO SAMEORIGIN (sauf `/track`), nosniff, Referrer, Permissions, plus de `X-Powered-By`** | — | — |
| #133 CSP Report-Only | MERGED | DEPLOYED `414f814` | **PASS : en-tête présent, `/api/csp-report` → 204** | — | — |
| #105 CSRF qr/status | MERGED | DEPLOYED `5a98eba` | **PASS : GET qr cross-site → 403** | — | — |
| #106 `/api/track` littéral | MERGED | DEPLOYED `b7e6bb7` | **PASS : `%` et `_` → 404** | — | — |
| #132 journaux en liste blanche | MERGED | DEPLOYED `f76b990` | PASS public | — | — |
| #134 Twilio signé | MERGED | DEPLOYED `413236b` | **PASS : cid inconnu → 404** | — | — |
| #135 feuille globale réservée admin | MERGED | DEPLOYED `845ac98` | PASS public | — | HUMAN-SHEETS-GLOBAL-001 |
| #123, #124, #139 erreurs génériques | MERGED | DEPLOYED `bd228f6`, `5fcab29`, `8842088` | PASS public | — | — |
| #129 erreurs fournisseurs | MERGED | DEPLOYED `feda848` | PASS public | — | — |
| #109 stats, #110 corbeille, #111 liste, #114 pages via API | MERGED | DEPLOYED `1776efb`, `dca2106`, `f7605cd`, `7437ca6` | PASS public ; écrans connectés UNKNOWN | — | H-SMOKE |
| #118 webhook-reset sans secret | MERGED | DEPLOYED `840d523` | PASS public | — | — |
| #103 envoi manuel | MERGED | DEPLOYED `dc5ad56` | PASS public ; envoi UNKNOWN | — | H-SMOKE |
| #116 secret-box, #117 clé ZR côté serveur, #119 jetons Meta, #99 state OAuth, #97 jeton d'instance | MERGED | DEPLOYED `948a6d0`, `c9a1029`, `d1dfb36`, `3c4461d`, `6f4a77f` | PASS public ; synchro ZR et connexion FB UNKNOWN | — | HUMAN-004 (clé de chiffrement) |
| #125 reprise 5xx, #126 espacement et prise atomique | MERGED | DEPLOYED `bb87555`, `7c54428` | PASS public ; file réelle UNKNOWN (journaux Vercel) | — | H-QUEUE (24 h de journaux) |
| #140 rétention, #141 backfill | MERGED | DEPLOYED `d7f53a6`, `2fa28dc` | N/A (outils jamais exécutés) | — | 008 / HUMAN-004 |
| #112 anti-rejeu WA durable | MERGED | DEPLOYED `3cca8b4` | PASS public (repli mémoire sans 006) | 006 | 006 optionnelle (GO) |

## Encore ouvertes (18)

| PR | STATUS | DEPLOY | SMOKE TEST | DEPENDENCY | BLOCKER |
|---|---|---|---|---|---|
| #107 validation Gemini (WA) | OPEN, CI verte | — | — | — | **Vercel : quota de déploiements atteint (« retry in 24 hours »)** |
| #144 docs | OPEN | — | — | — | quota Vercel |
| #98 signature Meta, #108 | OPEN | — | — | #107 | HUMAN-005 (`FACEBOOK_APP_SECRET` présent ?) |
| #101 prise de notification, #102 | OPEN | — | — | — | HUMAN-READONLY-ALL (NOTIF-STATUS) |
| #113 synchro diff | OPEN | — | — | — | HUMAN-READONLY-ALL (SYNCDIFF) |
| #115, #122 admin par claim | OPEN | — | — | — | ADMIN-CLAIM-001 (GO) |
| #120 secrets Shopify/Woo/Twilio | OPEN | — | — | — | HUMAN-READONLY-ALL (INTEGRATIONS-SECRET) |
| #121 → #130 → #131 → #137 → #138 | OPEN | — | — | ONCONFLICT | HUMAN-READONLY-ALL (ONCONFLICT) |
| #127 → #128 → #142 campagnes | OPEN, à jour avec main, 674/674 | — | — | ordre de la chaîne | **décision prise (SAFE DEFAULT)** ; quota Vercel |
| #146 tests webhook WA (A–G) + garde du script | OPEN, 670/670 | — | — | — | quota Vercel |
| #147 UX doublons de l'envoi manuel | OPEN, tsc / lint OK | — | — | — | quota Vercel |
| #148 SSRF / média / Google Sheet direct (remplace #137/#138) | OPEN, 761/761 | — | — | — | quota Vercel |
| #137, #138 | OPEN | — | — | chaîne #121 | **remplacées par #148** : à fermer après le merge de #148 |

## Constats faits en production pendant le déploiement

1. **`WHATSAPP_WEBHOOK_SECRET` absent** : le webhook WhatsApp entrant accepte un POST non authentifié (400 « Bad payload » au lieu de 401). → **WEBHOOK-SECRET-001** (P1), outillé par #145.
2. **`/api/ai-chatbot/relance` ouvert** : un POST non authentifié exécutait la relance pour tous les tenants. Un tel appel a été émis pendant la vérification (résultat : `relanced: 0`, aucun message). **Corrigé et déployé (#104)** : 401.
3. Quota de déploiements Vercel (offre Hobby) atteint après une trentaine de déploiements : les merges suivants sont suspendus jusqu'à la remise à zéro.

## Ordre de merge à la remise à zéro du quota Vercel

Une PR à la fois : merge → CI → déploiement → smoke.

1. #148 (P2 sécurité)
2. #107
3. #147
4. #146
5. #127
6. #128
7. #142
8. #144 (docs)

Puis fermer #137 et #138.

## Niveaux de risque (production)

| Niveau | Élément | État |
|---|---|---|
| P0 | détournement d'instance WhatsApp | **corrigé dans l'application (#143, déployé)** ; défense en base 009 : non appliquée (GO) |
| P1 | webhook WhatsApp entrant sans secret | **OUVERT** → WEBHOOK-SECRET-001 (humain) |
| P1 | relance non authentifiée | **FERMÉ** (#104, 401 vérifié en production) |
| P1 | Next.js vulnérable | **FERMÉ** (15.5.28 vérifié en production) |
| P2 | SSRF média / Sheets | corrigé dans #148 (non déployé : quota) |
| P2 | secrets en clair au repos | HUMAN-004 |
| P2 | Super Admin via profiles.role | #115 / #122 (ADMIN-CLAIM-001) |
| P3 | compte de service Google partagé | documenté |
