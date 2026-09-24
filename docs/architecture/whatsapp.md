# WhatsApp — Evolution API, envois, protections

## Evolution API

- Il n'y a qu'**un serveur partagé** (Railway) et une **clé globale**
  (`EVOLUTION_API_URL` / `EVOLUTION_API_KEY`). `resolveEvolutionCreds()`
  renvoie toujours ces deux variables : pas de BYOK.
- Chaque marchand a jusqu'à trois instances, `zrex_<12 hex de l'UUID>_<auto|sav|track>`,
  une par `service_type` (`auto_confirmation`, `sav`, `tracking`). Elles sont
  stockées dans `public.whatsapp_instances`.
- **Jeton d'instance.** Evolution v2 accepte sur toute route d'instance soit la
  clé globale, soit le `token` de l'instance (`auth.guard.ts`). Jusqu'au
  correctif `p0-evolution-instance-token`, ce token était l'**UUID du
  marchand**, et deux UUID réels figuraient dans le dépôt public. Les
  instances existantes doivent être recréées après le gel (HUMAN-003).
- Le webhook entrant est `POST /api/ai-chatbot/webhook/whatsapp?token=<WHATSAPP_WEBHOOK_SECRET>`.
  Evolution ne signe pas ses payloads : le secret dans l'URL est la seule
  authentification. Si la variable est absente, le mode est `unenforced`
  (HUMAN-002 : vérifier sa présence en production).

## Chemins d'envoi

Chaque ligne est un code qui appelle `/message/send*`. Les colonnes
indiquent les protections actives sur `main`, puis sur les branches de
correction.

| #   | Chemin                                      | Déclencheur                            | Plafond 24 h   | Warm-up        | Espacement                            | Journal `messages` | Anti-doublon                                       |
| --- | ------------------------------------------- | -------------------------------------- | -------------- | -------------- | ------------------------------------- | ------------------ | -------------------------------------------------- |
| 1   | `/api/whatsapp/send` (page Messages)        | clic                                   | oui            | **non** → oui¹ | 20-60 s (dans la requête)             | succès et échecs   | coupure Vercel → renvoi manuel ; corrigé¹          |
| 2   | drain `pending_notifications` (sync client) | chaque sync de chaque onglet           | oui            | oui            | 8 s, 2 max par sync                   | succès et échecs   | **aucun** entre onglets → prise atomique²          |
| 3   | handler `whatsapp.send` (file)              | tick \*/5 min                          | oui            | oui            | **aucun dans un tick** → 20 s³        | succès seulement   | idempotency_key, max_attempts = 1, prise atomique³ |
| 4   | réponses du chatbot + notification admin    | message entrant                        | non            | non            | —                                     | non                | anti-rejeu mémoire → Postgres⁴                     |
| 5   | relance des conversations inactives         | bouton, ou planificateur non configuré | **non** → oui⁵ | non → oui⁵     | **aucun, jusqu'à 50** → 1 par tenant⁵ | non → oui⁵         | prise atomique⁵                                    |
| 6   | résolution SAV (`reclamations/resolve`)     | clic                                   | non            | non            | —                                     | non                | double clic → prise atomique⁵                      |
| 7   | campagnes → jobs `whatsapp.send` (via #3)   | bouton Lancer / Renvoyer               | via #3         | via #3         | run_after 20-60 s, puis #3            | via #3             | `camp:<id>:<tél>` ; renvoi bloqué → corrigé⁶       |

Branches de correction :

1. `p1-legacy-send-guards` : warm-up appliqué, budget de 45 s (`maxDuration`
   60), destinataires non traités renvoyés dans `deferred`, « Renvoyer »
   limité aux échecs de moins de 24 h.
2. `p1-notification-drain-claim`.
3. `p1-queue-send-spacing` (à merger après le rapport 72 h).
4. `p1-durable-replay-guard` (et migration 006).
5. `p1-relance-sav-hardening`.
6. `p1-campaign-relaunch`.

## Circuit breaker

`autotim.tenant_settings.consecutive_send_failures` / `circuit_open_until` :
5 échecs consécutifs ouvrent le circuit pendant 30 min. **Seul le chemin #3
l'utilise.** Le chemin #1 a son propre coupe-circuit, limité à la requête.
Le chemin #2 n'en a pas : si la session est morte, chaque sync écrit 2
lignes `echec` par onglet. C'est le même motif que l'incident d'avril-juillet,
en plus petit. À traiter (backlog).

## Incident de référence

Du 2026-04-24 au 2026-07-30, la session était morte et les tentatives
s'accumulaient. Résultat : 532 471 lignes `echec` pour 45 envois réels
(~210 Mo, 42 % du quota). Voir la revue 005.

## Règles pour tout nouveau chemin d'envoi

1. Vérifier le plafond **au moment de l'envoi** : `remainingDailyQuota(sentToday, warmupStartedAt)`.
2. Laisser au moins 20 s depuis le dernier envoi réussi du tenant.
3. Réclamer atomiquement l'objet envoyé (notification, session, job) **avant**
   l'appel Evolution. Dans le doute, ne pas envoyer.
4. Ne jamais rejouer automatiquement un envoi dont on ignore l'issue.
5. Journaliser les succès dans `messages` (c'est le compteur du plafond) et
   ne pas y écrire les échecs.
6. Choisir l'instance du `service_type` concerné, jamais « la » ligne du
   marchand.
