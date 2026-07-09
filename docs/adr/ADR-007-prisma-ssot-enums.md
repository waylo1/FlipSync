# ADR-007 — `schema.prisma` comme SSOT des enums TypeScript

- **Statut :** Accepté
- **Date :** 2026-01-01 (pivot Sprint 3)
- **Contexte :** Les enums TypeScript dupliqués à la main (`ListingStatus`, `TransactionType`…)
  dérivaient du schéma Prisma au fil des évolutions — bug de synchronisation silencieux.
- **Décision :** `packages/db/prisma/schema.prisma` est la seule source. Les enums TS sont
  **générés** (`packages/core/scripts/generate-enums.mjs`) à chaque `build`/`typecheck`, jamais
  recopiés à la main. Sortie gitignorée (`packages/core/src/generated/`).
- **Conséquences :** Impossible de commiter un enum périmé. Toute nouvelle valeur d'enum passe
  obligatoirement par une migration Prisma.
