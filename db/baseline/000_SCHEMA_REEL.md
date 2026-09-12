# BASELINE — Schéma réellement observé en production

> Généré en Phase 0 par introspection **read-only** de l'API PostgREST
> (sondage de colonnes : une colonne inexistante renvoie `42703`, une colonne
> existante sur une table à RLS cassée renvoie `42P17`).
>
> ⚠️ **Introspection partielle.** Sans `SUPABASE_SERVICE_ROLE_KEY` en local, on ne
> peut lire ni `information_schema`, ni les types exacts, ni les contraintes, ni
> les policies. Les colonnes ci-dessous sont **confirmées présentes/absentes**,
> mais leurs **types sont déduits du code**, pas observés.
>
> Pour compléter : exécuter `001_introspection.sql` dans Supabase SQL Editor
> (read-only) et coller le résultat ici.

## ⚠️ AVERTISSEMENT CRITIQUE

`supabase_orders.sql` à la racine du repo décrit un schéma **FAUX et obsolète**
(`tracking`, `client`, `whatsapp`, `product`, `status`). Le rejouer
**détruirait la production**. Confirmé par sondage : ces 5 colonnes sont ABSENTES.

Le projet Supabase est **partagé avec une autre application** qui a déjà écrasé
la table `orders` par le passé. Toute migration doit être scopée et sauvegardée.

---

## État RLS observé (requête avec clé anon)

| Table | Statut |
|---|---|
| `orders` | 🔴 **500 — récursion RLS infinie** (`42P17`) |
| `profiles` | 🔴 **500 — récursion RLS infinie** (`42P17`) |
| `messages` | 🔴 **500 — récursion RLS infinie** (`42P17`) |
| `ai_chat_sessions` | ✅ 200 |
| `pending_notifications` | ✅ 200 |
| `whatsapp_instances` | ✅ 200 |
| `chatbot_configs` | ✅ 200 |
| `campaigns` | ✅ 200 |
| `campaign_recipients` | ✅ 200 |
| `user_api_credentials` | ✅ 200 |
| `user_sync_settings` | ✅ 200 |
| `message_templates` | ✅ 200 |
| `autoswap_size_equivalences` | ✅ 200 |
| `plans` | ✅ 200 |
| `voice_calls` | ⚪ **TABLE INEXISTANTE** (`PGRST205`) |
| `voice_call_settings` | ⚪ **TABLE INEXISTANTE** |
| `integrations` | ⚪ **TABLE INEXISTANTE** |
| `user_profiles` | ⚪ **TABLE INEXISTANTE** |

**Conséquence** : les 3 tables centrales sont inaccessibles en RLS. L'application
ne fonctionne que parce que **48 routes sur 58 utilisent `createServiceClient()`**
qui contourne la RLS. L'isolation multi-tenant repose donc **entièrement sur le
scoping applicatif `.eq('user_id', ...)`**, pas sur la base.

---

## `orders` — colis ZRExpress (source de vérité actuelle)

Colonnes **confirmées présentes** :

| Colonne | Type (déduit du code) | Note |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | tenant |
| `tracking_number` | text | clé métier, unique avec user_id |
| `customer_name` | text | |
| `customer_whatsapp` | text | |
| `product_name` | text | |
| `delivery_status` | text | 6 valeurs internes |
| `situation` | text | libellé ZRExpress brut |
| `wilaya` | text | |
| `wilaya_code` | text | |
| `district` | text | |
| `cod` | numeric | |
| `attempts` | integer | |
| `weight` | text | |
| `delivery_type` | text | |
| `last_update` | timestamptz | |
| `created_at` | timestamptz | utilisé par le quota mensuel |
| `deleted_at` | timestamptz | soft delete (corbeille) |

Colonnes **confirmées ABSENTES** : `updated_at`, `commune`, `state`,
`external_id`, `source`, `tracking`, `client`, `whatsapp`, `product`, `status`.

> 🐛 **BUG-11** : `src/app/api/campaigns/[id]/send/route.ts:152-156` sélectionne et
> trie sur `orders.updated_at` — colonne inexistante. Toute campagne utilisant une
> **audience personnalisée** échoue silencieusement (nom/wilaya/tracking vides).

Contrainte connue (déduite du code) : `onConflict: 'user_id,tracking_number'`.

---

## `profiles`

Présentes : `id`, `email`, `full_name`, `avatar_url`, `company_name`,
`plan_id`, `role`, `status`, `created_at`, `updated_at`,
`whatsapp_warmup_started_at` ✅ *(migration warm-up bien appliquée)*.

Absentes : `onboarding_completed_at`, `organization_id`.

---

## `messages` — log d'envois (sert de compteur de quota 24 h)

Présentes : `id`, `user_id`, `tracking_number`, `customer_name`,
`customer_whatsapp`, `message`, `status`, `sent_at`, `error_message`, `created_at`.

Absente : `campaign_id` → **aucune attribution de revenu campagne → commande possible**.

---

## `whatsapp_instances`

Présentes : `id`, `user_id`, `instance_name`, `service_type`, `connected`,
`created_at`, `updated_at`.
Absentes : `phone`, `webhook_url`.

---

## `user_sync_settings` — 🔴 secrets en clair

Présentes : `user_id`, `zrexpress_token` 🔴, `zrexpress_tenant_id`, `templates`,
`notify_enabled`.

## `user_api_credentials` — 🔴 secrets en clair

Présentes : `user_id`, `service`, `api_key` 🔴, `api_url`, `api_secret` 🔴, `is_active`.

---

## `ai_chat_sessions` — conversations

Depuis `supabase_aichatbot_full.sql` (non re-vérifié colonne par colonne) :
`id`, `user_id`, `channel`, `contact_id`, `contact_name`, `template_type`,
`conversation JSONB`, `extracted_data JSONB`, `is_complete`, `sheets_sent`,
`human_handover`, `failure_count`, `relance_sent`, `human_pause_until`,
`tokens_used`, `created_at`, `updated_at`,
`UNIQUE(user_id, channel, contact_id)`.

> ⚠️ `conversation` en JSONB : non requêtable, non paginable, lecture-modification-
> écriture complète à chaque message → **risque de perte de messages en concurrence**.

---

## Tables déclarées en SQL mais INEXISTANTES en base

`voice_calls`, `voice_call_settings`, `integrations`, `user_profiles`.

Le code les interroge pourtant :
- `voice_calls` → 5 fichiers
- `voice_call_settings` → 4 fichiers
- `integrations` → 3 fichiers
- `user_profiles` → 1 fichier (`src/contexts/AuthContext.tsx:93`)

➜ Les pages **Voice Calls** et **Intégrations** sont non fonctionnelles en production.

---

## Index observés dans le repo (non vérifiés en base)

`idx_orders_tracking_number`, `idx_orders_delivery_status`,
`idx_messages_tracking_number`, `idx_ai_sessions_user_channel_contact`,
`idx_ai_sessions_pause`, `idx_ai_sessions_relance`,
`idx_whatsapp_instances_name`, `idx_facebook_connections_page`.

**Manquants et nécessaires** : `orders(user_id)`, `orders(user_id, created_at)`
(quota mensuel), `orders(user_id, deleted_at)`.
