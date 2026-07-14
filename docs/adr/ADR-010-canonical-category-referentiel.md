# ADR-010 — `CanonicalCategoryId` : référentiel versionné, pas un enum

- **Statut :** Accepté
- **Date :** 2026-07-14
- **Contexte :** Q1 (MASTER-REMED.md) bloquait C1 : un enum `CanonicalCategory` figé (~12 valeurs) exige une migration + re-mapping de N connecteurs à chaque ajout — coût récurrent et arbitrage de cadence non résolu.
- **Décision :** `CanonicalCategoryId` est un référentiel versionné (données, table/fichier de référence), extensible sans migration de schéma. Le Core (`packages/core`, prompt IA, mobile) ne manipule que cet identifiant canonique — jamais une taxonomie de canal. Chaque connecteur (`packages/marketplace`) est seul responsable du mapping `CanonicalCategoryId` → taxonomie de sa marketplace.
- **Conséquences :** Ajouter une catégorie = ajouter une entrée au référentiel, pas une migration Prisma ; le mapping par connecteur peut rester incomplet/`null` sans bloquer les autres canaux. Le format exact du référentiel (table Postgres vs fichier versionné dans `packages/core`) et sa politique d'évolution restent à spécifier au Lot 1 — hors périmètre de cet ADR, qui fige uniquement la nature (référentiel, pas enum) et la frontière (Core = id, connecteur = mapping).
