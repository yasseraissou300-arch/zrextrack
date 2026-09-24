# Architecture AutoTim — vue d'ensemble

_État au 2026-09-24 (`main` = 9c2b249). Rédigé à partir du code. Les points
non vérifiés en production sont signalés comme tels._

AutoTim est un SaaS multi-tenant pour les e-commerçants algériens. Il couvre
le suivi des colis ZRExpress, les notifications et campagnes WhatsApp, un
chatbot IA de confirmation de commande et de SAV, et l'AutoSwap.

## Composants

```
Navigateur (Next.js 15 / React 19)
   │  cookie de session Supabase
   ▼
Vercel — projet « autotim » (Hobby)            cron-job.org (job 8441022)
   ├─ pages (App Router)                          │ POST */5 min
   ├─ /api/* (runtime Node)  ◄────────────────────┘ /api/cron/tick
   │     │ service_role (contourne la RLS)
   │     ▼
   │  Supabase (Postgres + PostgREST + Auth) — projet PARTAGÉ avec une autre app
   │     ├─ public.*   tables AutoTim historiques (orders, messages, …)
   │     └─ autotim.*  file de jobs, réglages tenant (schéma isolé)
   │
   ├─► Evolution API (Railway)  ── WhatsApp non officiel (Baileys)
   ├─► ZRExpress API            ── colis (clé + tenant ZR par marchand)
   ├─► Gemini                   ── IA du chatbot (clés BYOK du marchand)
   ├─► Google Sheets (Apps Script du marchand) ── commandes / réclamations
   └─◄ Meta (Facebook Messenger) ── webhook + OAuth
```

## Documents

| Document                                                                                     | Contenu                                                                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [whatsapp.md](whatsapp.md)                                                                   | Evolution, instances, les **sept** chemins d'envoi et leurs protections, webhook entrant, risques de blocage |
| [queue-scheduler.md](queue-scheduler.md)                                                     | File `autotim.jobs`, tick, idempotence, verrous, scheduler cron-job.org                                      |
| [security-multitenant.md](security-multitenant.md)                                           | Authentification, service_role, état de la RLS, webhooks, secrets, isolation des tenants                     |
| [ai-chatbot-sav.md](ai-chatbot-sav.md)                                                       | Chatbot WhatsApp/Messenger, extraction des commandes, Google Sheets, relance, SAV                            |
| [campaigns.md](campaigns.md)                                                                 | Campagnes WhatsApp : lancement, dispatch, renvoi                                                             |
| [zrexpress.md](zrexpress.md)                                                                 | API ZRExpress : pagination, limites, synchronisation, AutoSwap                                               |
| [../../db/reviews/2026-09-24_revue_003_005.md](../../db/reviews/2026-09-24_revue_003_005.md) | Revue des migrations proposées 003 (index) et 005 (nettoyage `messages`)                                     |

## Contraintes structurantes

1. **Base partagée.** Une autre application écrit dans `public` (tables
   PascalCase, schéma `pattron`) et a déjà écrasé `orders`. Toute structure
   nouvelle va dans `autotim`.
2. **RLS cassée sur `orders`, `messages` et `profiles`** (récursion 42P17,
   confirmée le 2026-09-23). Les lectures faites depuis le navigateur avec la
   clé anon échouent en 500. L'isolation repose sur le scoping `user_id` fait
   dans chaque route serveur (`createServiceClient()`). Le correctif SQL (004)
   est prêt mais n'est pas exécuté.
3. **WhatsApp non officiel.** Un numéro a déjà été suspendu après une rafale
   d'environ 100 messages. Les règles anti-ban sont : plafond de 40 par 24 h,
   warm-up, 20-60 s entre deux envois, variation du texte, circuit breaker.
   **Tout** chemin d'envoi doit les respecter (voir whatsapp.md).
4. **Vercel Hobby.** Une fonction ne dépasse pas 60 s et les journaux sont
   conservés 1 h. Tout traitement long passe par la file.
5. **Dépôt public.** Aucun secret ni identifiant réel dans le code, les
   tests ou la documentation.
