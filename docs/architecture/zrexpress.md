# ZRExpress — API, synchronisation, AutoSwap

## API

- `POST https://api.zrexpress.app/api/v1.0/parcels/search`, avec les en-têtes
  `X-Api-Key` et `X-Tenant` (clé et tenant ZR du marchand).
- La réponse est de la forme `{ items, pageNumber, pageSize, totalCount,
totalPages, hasPrevious, hasNext }`.
- **Limite** : 300 requêtes par 60 s (en-têtes `ratelimit-*`), avec un 429
  « Retry after 60 second(s) ».
- **Pagination** : `pageSize` va jusqu'à 1 000. **`orderBy` est obligatoire**
  pour une pagination stable. Sans lui, 7 pages renvoyaient 6 403 lignes pour
  5 842 colis distincts.
- Schéma : `https://api.zrexpress.app/swagger/internal-v1/swagger.json`
  (`SearchSupplierParcelsRequest`, `SearchSupplierParcelResponse`). La date
  du dernier changement d'état est `lastStateUpdateAt` (date-time, nullable).

## `fetchAllParcels` (`src/lib/zrexpress/parcels.ts`)

- Pages de 1 000, `orderBy ['createdAt desc', 'id']`, jusqu'à `hasNext =
false`, avec une limite de sécurité de 500 pages.
- Une seule reprise sur un 429, après au plus 20 s.
- Dédoublonnage par `id`.
- Environ 7 requêtes et 3 à 9 s pour un compte d'environ 6 400 colis.

## Synchronisation

| Mode (`tenant_settings.sync_source`) | Déclencheur                                          | Code                       |
| ------------------------------------ | ---------------------------------------------------- | -------------------------- |
| `client` (tenant pilote)             | chaque onglet ouvert, toutes les 5 min, et le bouton | `POST /api/sync-zrexpress` |
| `server`                             | tick, clé `sync:<tenant>:<créneau>`                  | handler `zrexpress.sync`   |
| `both`                               | les deux, dédupliqués par la même clé                | —                          |

Étapes d'un sync :

1. Lecture de tous les colis.
2. `mapStatus(état, situation)`.
3. Quota mensuel du plan (`countOrdersThisMonth`).
4. Détection des changements de statut, qui alimentent `pending_notifications`.
5. **Upsert de toutes les commandes** (`onConflict user_id, tracking_number`).
6. Drain de 2 notifications au plus.

### Points d'attention

- Sur `main`, `last_update` reçoit l'**heure du sync** pour toutes les
  lignes. Les statistiques « aujourd'hui » et « 7 jours » en deviennent
  fausses. Corrigé sur `p1-orders-stats-correctness` : `lastStateUpdateAt`.
- Le sync réécrit environ 5 000 lignes par passage et par onglet. C'est une
  piste de charge base à mesurer après la fenêtre (voir revue 003).
- Lectures non paginées sur `orders`, plafonnées à 1 000 lignes par PostgREST :
  - `/api/stats` : corrigé sur branche ;
  - `/api/orders/reclassify` et `/api/orders/deleted` : backlog.

## AutoSwap

- Est « swappable » un colis avec `swap.isEligibleForSwap === true`. C'est la
  source de vérité, et le compteur correspond à la page Swaps de ZR (PR #94).
  Si le drapeau est absent, on se rabat sur la situation et l'état vivant.
- Les PR #94 et #95 sont en production. Le compteur de swappables
  correspond à celui de ZRExpress, vérifié le 2026-09-19.
