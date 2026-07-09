# Architecture Decision Records — FlipSync

Journal court des décisions techniques structurantes. Objectif : ne pas oublier **pourquoi**,
pas produire de la documentation. Chaque ADR fait 10 lignes maximum (cf. `ADR-000-template.md`).

**Règle d'ajout :** un ADR seulement pour une décision qui **fige un contrat** (schéma, API,
événement) ou **choisit une techno structurante**. Pas d'ADR pour une préférence de style ou un
détail d'implémentation isolable derrière une interface. Voir TECH_GOVERNANCE.md §4.

## Index

| ADR | Titre | Statut |
|---|---|---|
| [001](ADR-001-centimes-entiers.md) | Valeurs monétaires en centimes entiers | Accepté |
| [002](ADR-002-monolithe-modulaire.md) | Monolithe modulaire sur Turborepo | Accepté |
| [003](ADR-003-ia-cote-serveur.md) | Inférence IA côté serveur (abandon on-device) | Accepté |
| [004](ADR-004-publication-apis-officielles.md) | Publication via APIs partenaires officielles uniquement | Accepté |
| [005](ADR-005-draftjob-postgres.md) | Jobs IA asynchrones persistés en Postgres | Accepté |
| [006](ADR-006-admin-emails.md) | Autorisation admin par liste blanche d'emails | Accepté |
| [007](ADR-007-prisma-ssot-enums.md) | `schema.prisma` comme SSOT des enums TypeScript | Accepté |
| [008](ADR-008-fournisseur-inference-prod.md) | Fournisseur d'inférence IA en production | Ouvert |
