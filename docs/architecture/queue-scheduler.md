# File de jobs et scheduler

## Schéma `autotim` (migrations 002 et 002b, exécutées le 2026-09-11)

- **`autotim.jobs`**
  - colonnes : `id`, `tenant_id`, `type` (`zrexpress.sync` | `whatsapp.send` |
    `campaign.dispatch`), `payload`, `status` (`pending` | `running` | `done` |
    `failed` | `dead`), `run_after`, `attempts`, `max_attempts`, `locked_at`,
    `locked_by`, `last_error`, `idempotency_key` ;
  - contraintes : `attempts ≤ max_attempts + 1`, et un job est `running` si et
    seulement si `locked_at` est renseigné ;
  - index : `jobs_idempotency_uniq` est **unique et non partiel**, donc une clé
    reste prise pour toujours. Les autres index servent la prise, la
    récupération des verrous morts, la vue par tenant et la DLQ.
- **`autotim.tenant_settings`** : `auto_sync_enabled`, `sync_source`
  (`client` | `server` | `both`), circuit breaker WhatsApp.
- **Droits** : `anon` et `authenticated` n'ont rien. `service_role` a
  SELECT, INSERT et UPDATE, **sans DELETE** (exception prévue : 006
  `webhook_events`).

## Tick — `POST /api/cron/tick`

1. Authentification : `x-webhook-token` = `CRON_TICK_SECRET` (401 si absent,
   403 si invalide).
2. `recoverStaleLocks` : un job `running` depuis plus de 5 min repasse en
   `pending`.
3. Planification des syncs des tenants `server` ou `both`, clé
   `sync:<tenant>:<créneau de 5 min>`.
4. `runTick` :
   - budget de 25 s et marge de 3 s ;
   - prise de 5 jobs à la fois, par compare-and-swap ;
   - un job n'est jamais démarré sans marge.
5. `maxDuration = 30`.

### Résultats d'un handler

- `done`.
- `reschedule` : attente légitime, **aucune** tentative consommée (quota,
  circuit, espacement).
- `failed` : backoff, ou `dead` si `attempts ≥ max_attempts`.

**Reprise d'un verrou mort** : la prise porte `attempts` à `max + 1`, et le
runner l'envoie alors en DLQ **sans exécuter le job**. Un `whatsapp.send`
interrompu n'est jamais rejoué.

### Défauts corrigés sur branche (à merger après le rapport 72 h)

- **`p1-tick-gateway-retry`** : une seule reprise après 1 s sur une erreur
  passerelle (502/503/504), limitée à trois lectures ou écritures
  idempotentes. Le 504 Supabase à environ 5 s touche ~7 % des ticks.
- **`p1-queue-send-spacing`** :
  - la prise et `attempts` passent dans **un seul** UPDATE. Avant, un 504 sur
    l'incrément, suivi d'une mort de la fonction, permettait de rejouer un
    envoi ;
  - espacement de 20 s par tenant dans `whatsapp.send`. Sans cela, tous les
    envois devenus dus entre deux ticks partaient à la suite.
- **`p1-campaign-relaunch`** : identifiant de lancement dans la clé
  `campdisp` (voir campaigns.md).

## Scheduler

- **cron-job.org**, job 8441022 : `*/5`, POST, en-tête `x-webhook-token`,
  timeout de 30 s. GitHub Actions a été écarté : retard médian mesuré de 3 h 19.
- Rétention des traces :
  - historique cron-job.org : ~50 exécutions (~4 h) ;
  - Supabase Free : 24 h ;
  - Vercel Hobby : 1 h.
- **Fenêtre de mesure 72 h v2** : du 2026-09-23T22:15Z au 2026-09-26T22:15Z.
  Collecteur `.claude/autotim-measure/collect.mjs`, lancé toutes les heures.
  Aucun changement de production pendant la fenêtre.

## Points ouverts

- `autotim.jobs` n'est jamais purgée, faute de DELETE. En mode serveur, cela
  fait 288 jobs de sync par tenant et par jour : prévoir une rétention.
- Les clés d'idempotence sont éternelles. Tout nouveau type de job doit
  prévoir le cas « même travail relancé plus tard » (leçon du renvoi de
  campagne).
