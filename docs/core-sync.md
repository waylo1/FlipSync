# Core Sync Engine — publication multi-plateformes (Phase 3)

> Contrats figés : ADR-009. Types : `packages/core/src/types/sync.ts`.
> Moteur : `packages/marketplace/src/sync-publisher.ts`. Service :
> `apps/api/src/services/publication.service.ts`.

## Pipeline

```
Listing (QUEUED) ─ listingToUnified() ─→ UnifiedListing (pivot agnostique)
                                              │
                              CoreSyncPublisher.publishMany(pivot, targets)
                                              │  gates sans réseau : pivot invalide → INVALID_PAYLOAD,
                                              │  connecteur absent → CONNECTOR_UNAVAILABLE,
                                              │  mode non supporté → UNSUPPORTED_MODE
                                              │  puis Promise.allSettled — throw → CONNECTOR_CRASH,
                                              │  pannes isolées par plateforme
                                              ▼
                                         SyncReport (1 résultat par cible)
```

- **Pivot** : union discriminée `fixed | auction`, whitelist stricte, 100 % agnostique
  (aucun type plateforme — gate `isUnifiedListingValid`). Argent en centimes Int.
- **Exigence durcie** : le pivot exige **≥ 1 photo** ; un listing sans photo échoue en
  `INCOMPLETE_DRAFT:photos` (le flux v1 tolérait l'absence de photo).
- **Échec = valeur retournée** (`SyncFailure`), jamais levé. Une exception échappée
  d'un connecteur est un bug, normalisée `CONNECTOR_CRASH` sans bloquer les autres.

## Règle du Jeton Global (décision produit, Run 3)

1 publication = 1 transaction. Le **débit** a lieu à `validate()` (commit wallet) — jamais
à la publication.

| Résultat `publishMany` | Statut listing | Wallet |
|---|---|---|
| ≥ 1 plateforme publiée | `PUBLISHED` + `ListingPublication` par succès | **aucun remboursement** |
| 100 % d'échec | `PUBLISH_FAILED` (`failureReason` = codes agrégés) | **remboursement total** (`failPublish`, idempotent) |

`ListingPublication` (`@@unique([listingId, marketplace])`) persiste `externalId`/`url`
par plateforme — clé des opérations futures (update/withdraw/checkStatus), upsert
idempotent en cas de re-tentative. Remplace à terme `publishedLbc/publishedVinted`.

## LegacyConnectorAdapter (transitoire)

Fait entrer les connecteurs v1 (LBC/Vinted + mock, contrat `publish(payload, credentials)`)
dans le pipeline v2 sans réécriture :

- construit **par requête** par le service api — la catégorie **par plateforme**
  (`categorieVinted` / `categorieLbc`) est injectée dans `toPayload`, jamais lue du pivot ;
- credentials résolus paresseusement (`MarketplaceAuthService`) → `CREDENTIALS_MISSING`
  sans appel réseau ; codes v1 libres normalisés vers `SyncErrorCode` (detail = code brut) ;
- `reportPublishOutcome` branché (état `AUTH_ERROR` de `GET /marketplace/status` conservé) ;
- `update/withdraw/checkStatus` → `CONNECTOR_UNAVAILABLE` (v1 = publish seul).

Disparaît à la migration des connecteurs LBC/Vinted vers le contrat v2.

## Observabilité

Un log structuré par plateforme cible : `{ listingId, marketplace, ok, code?, detail? }` —
zéro PII (ni titre, ni description, ni email). `SyncFailure.detail` ne sort jamais de l'API.

## Migrations Prisma (Run 4)

Historique re-baseliné en une migration initiale unique `0_init` (l'ancien historique
n'était pas rejouable — P3006, table `Mission` créée hors migrations). `prisma migrate
deploy` (Dockerfile prod) fonctionne depuis une DB vierge ou depuis la DB baselinée.
Toute évolution de schéma passe désormais par `prisma migrate dev` (plus de `db push`).
