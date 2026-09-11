# Migrations base de données — AutoTim

## Contexte impératif

Le projet Supabase `hhqgnzlwgtuxcmpkouen` est **partagé avec une autre application**.

Schémas observés : `auth`, `extensions`, `graphql`, `graphql_public`, **`pattron`**,
`public`, `realtime`, `storage`, `vault`.

L'autre application écrit **dans `public`**, avec des tables PascalCase (style Prisma) :
`Account`, `Boutique`, `Commande`, `Integration`, `Session`, `TrackingEvent`, `User`,
`VerificationToken`, `WaMessage`, `WaTemplate` — plus le schéma `pattron`
(`Pattern`, `User`).

⚠️ **Son domaine métier recouvre celui d'AutoTim** (`Commande` ↔ `orders`,
`WaMessage` ↔ `messages`). Elle a déjà écrasé la table `orders` par le passé.

➜ **`public` ne doit jamais être considéré comme contrôlé par AutoTim.**
Toute structure nouvelle va dans le schéma dédié `autotim`.

---

## Ordre d'exécution

| Fichier                                | Statut                                                                                                | Portée               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| `002_autotim_queue.sql`                | ✅ **EXÉCUTÉE** le 2026-09-11 (GO Phase 1, A1–A4)                                                     | `autotim` uniquement |
| `002b_autotim_grants.sql`              | ✅ **EXÉCUTÉE** le 2026-09-11 (GO explicite) — `service_role` = SELECT/INSERT/UPDATE, **sans DELETE** | `autotim` uniquement |
| `../proposed/003_public_indexes.sql`   | ⏸️ **NON EXÉCUTÉ** — validation séparée                                                               | `public`             |
| `../proposed/004_rls_fix_42P17.sql`    | ⏸️ **NON EXÉCUTÉ** — D1 = plus tard                                                                   | `public`             |
| `../proposed/005_messages_cleanup.sql` | ⏸️ **NON EXÉCUTÉ** — E2/E3 = plus tard                                                                | `public`             |

> `001_introspection.sql` (dans `../baseline/`) est en lecture seule et peut être
> rejoué à tout moment.

---

## Avant toute exécution

1. Lancer une **sauvegarde manuelle** : GitHub → Actions → « Sauvegarde base de
   donnees » → _Run workflow_. Vérifier que l'artefact chiffré est produit.
2. Vérifier qu'aucune autre migration n'est en cours côté autre application.
3. Exécuter le fichier **dans son intégralité** dans Supabase → SQL Editor.
4. Exécuter la requête de vérification en fin de fichier.

---

## Garanties de `002_autotim_queue.sql`

Vérifiées mécaniquement (analyse au niveau instruction, littéraux et
commentaires exclus) :

- 21 instructions exécutables
- **0** instruction destructive (`DROP` / `DELETE` / `TRUNCATE` / `UPDATE` / `INSERT`)
- **0** référence à `public.`
- **0** clé étrangère (ni vers `auth.users`, ni vers les tables métier)
- Les 2 seuls `ALTER` portent sur `autotim.jobs` et `autotim.tenant_settings`
- Idempotente : `IF NOT EXISTS` partout, rejouable sans effet de bord

Aucun tenant n'est basculé par cette migration : `sync_source` vaut `client`
par défaut, donc le navigateur reste seul maître tant que vous ne basculez pas
explicitement un tenant.

---

## Rollback

### Niveaux normaux — aucun ne touche la base

| Niveau    | Action                                                                             | Perte                                  |
| --------- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| Tenant    | `UPDATE autotim.tenant_settings SET sync_source = 'client' WHERE tenant_id = '…';` | aucune                                 |
| Scheduler | Désactiver la tâche sur cron-job.org                                               | aucune — le navigateur prend le relais |
| Code      | `git revert` de la branche Phase 1                                                 | aucune                                 |

Ces trois niveaux couvrent tous les cas de retour arrière prévus.

### Niveau exceptionnel — PROCÉDURE MANUELLE UNIQUEMENT

> 🚫 **La suppression du schéma n'est présente dans aucun script, aucun fichier
> exécutable et aucune procédure automatisée de ce dépôt.** C'est délibéré.
>
> Elle ne doit être envisagée que si le schéma `autotim` doit disparaître
> entièrement, et seulement après :
>
> 1. sauvegarde manuelle vérifiée,
> 2. validation explicite du propriétaire du projet,
> 3. confirmation qu'aucun job n'est en cours (`status = 'running'`),
> 4. saisie manuelle de la commande dans Supabase SQL Editor.
>
> La commande n'est volontairement pas reproduite ici : elle doit être écrite
> à la main, en conscience, au moment où elle est réellement nécessaire.
> Elle ne retire rien de `public` — cette migration n'y a jamais touché.

---

## Journal d'exécution

| Date       | Fichier                                                       | Exécuté par                                                                                    | Résultat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-11 | `002_autotim_queue.sql`                                       | Claude (Chrome → SQL Editor), après sauvegarde run #14 vérifiée                                | ✅ `jobs` 14 col / `tenant_settings` 8 col, 7 index, 8 contraintes (6 CHECK + 2 PK), RLS on, 0 policy, 0 FK, 0 ligne. `public` : signatures d'introspection identiques à la baseline (RLS/policies 3880, index 2495, 48 policies, 42 tables, 86 index, 90 contraintes, 417 colonnes, messages 532 516, orders 7 155).                                                                                                                                                                                          |
| 2026-09-11 | Exposition PostgREST                                          | Claude (Data API → Settings → Exposed schemas)                                                 | ✅ `autotim` ajouté seul (`public, graphql_public, autotim`) ; `pattron` non exposé. anon → `42501 permission denied for schema autotim`.                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-09-11 | `002b_autotim_grants.sql`                                     | Claude (Chrome → SQL Editor), hash exécutable `b8bbb83e9d844a15`                               | ✅ ACL `jobs`/`tenant_settings` = `service_role=arw` (pas de `d`/`D`). Test réel `SET ROLE service_role` : INSERT → UPDATE (pending→running→done) → SELECT OK ; DELETE → `42501` (voulu, le code n'en a pas besoin). Job de test supprimé par `postgres`. anon/authenticated : tout `false`, PostgREST anon → `42501 permission denied for schema autotim`. `public` : signatures identiques (3880/2495/1913), 48 policies, 42 tables, 86 index, 90 contraintes, 417 colonnes, messages 532 516, orders 7 155. |
| 2026-09-11 | Test applicatif réel `tests/integration/autotim-real.test.ts` | Claude (`npm run test:integration`, `createServiceClient().schema('autotim')`, run `f2b2cb19`) | ✅ 12/12 : accès schéma, INSERT, SELECT, idempotence, claim CAS (2e worker refusé), reschedule, contrainte `jobs_locked_coherence_chk` (23514), markDone, stale lock > 5 min repris, DLQ, tenant_settings, DELETE refusé (42501). Nettoyage ciblé par `postgres` (2 jobs + 1 tenant_settings du tenant de test). État final : `jobs` 0, `tenant_settings` 0, `public` identique (3880/2495/1913, messages 532 516, orders 7 155).                                                                              |

---

## Dette documentaire (hors périmètre, à corriger plus tard)

- `COMMENT ON TABLE autotim.jobs` : le texte de `002_autotim_queue.sql` a été corrigé (compare-and-swap, plus « FOR UPDATE SKIP LOCKED »). **En base, le commentaire posé lors de l'exécution du 2026-09-11 porte encore l'ancien texte** : sans effet fonctionnel ; à aligner lors d'une prochaine exécution validée (`COMMENT ON TABLE` seul, ou rejeu idempotent de 002).
