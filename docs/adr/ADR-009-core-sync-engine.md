# ADR-009 — Core Sync Engine : pivot UnifiedListing + contrat connecteur v2

- **Statut :** Accepté
- **Date :** 2026-07-13
- **Contexte :** Extension multi-marketplace API-first (eBay, Shopify). Le contrat v1 (`ListingPayload`/`MarketplaceConnector` publish seul) est bi-plateforme, sans mode enchère, sans update/withdraw/checkStatus.
- **Décision :** DTO pivot `UnifiedListing` dans `@flipsync/core` (union discriminée `fixed | auction`, whitelist stricte, 100 % agnostique — tout mapping plateforme vit dans le connecteur) ; contrat `MarketplaceConnector` v2 (publish/update/withdraw/checkStatus, échecs `SyncFailure` retournés, jamais levés) dans `@flipsync/marketplace` ; `publishMany` isole les pannes par plateforme (allSettled, crash ⇒ `CONNECTOR_CRASH`).
- **Conséquences :** v1 exporté `LegacyMarketplaceConnector` jusqu'à migration LBC/Vinted ; enum `Marketplace` étendue (EBAY, SHOPIFY) au premier connecteur implémenté ; la persistance des externalId par plateforme (retour du pivot retiré en F4, avec consommateur cette fois) exigera schéma + migration dédiés.
