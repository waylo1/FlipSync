# FLIPSYNC-REMED.md — Phase 2

> Référence : FLIPSYNC-AUDIT.md. Un commit atomique par finding, taggé `[Fx]`.
> Anti-fan-out : exécution séquentielle. Statuts mis à jour au fil des commits.

## Routage

| id | sév | statut | route | commit |
|---|---|---|---|---|
| F1 | S2 | **[OK] CORRIGÉ** | Fix direct (session courante) | `fix(listing): … [F1]` — tests ai 31/31, api 91/91, wallet 25/25 |
| F4 | S3 | **[OK] CORRIGÉ** | Fix direct (session courante) | `refactor(db): … [F4]` — delta jamais commité : nettoyage working tree + DB, aucun delta code vs HEAD |
| F5 | S3 | **[OK] CORRIGÉ** | Fix direct (session courante) | `refactor(core): … [F5]` — tests core 56/56, marketplace 6/6, api 91/91 |
| F2 | S2 | **[OK] CORRIGÉ** | Décision Maxime : retrait (recharge manuelle MVP) | `fix(wallet): … [F2]` — tests wallet 24/24, ai 31/31, api 91/91 |
| F3 | S3 | À ROUTER | Sonnet | — |
| F6 | S3 | À ROUTER | Sonnet | — |
| F7 | S3 | À ROUTER | Sonnet | — |
| F8 | S3 | **[OK] CORRIGÉ** | Fix direct (session courante) | `docs(ai): … [F8]` — tests ai 31/31, api 91/91 |
| F9 | S3 | **[OK] CORRIGÉ** | Fix direct (session courante) | `fix(wallet): … [F9]` — tests wallet 25/25 |

## Fix direct — session courante

### F1 — validation + mise en file atomiques
`ListingEngine.validate()` enchaîne désormais `DRAFT_READY → USER_VALIDATED` (+ `wallet.commit`)
`→ QUEUED` dans **une seule** `$transaction`. La route `POST /listing/:id/validate` n'appelle
plus `queue()` séparément. Contrat HTTP inchangé (réponse = listing `QUEUED`).
`queue()` est conservé : chemin de récupération pour d'éventuelles lignes historiques
bloquées `USER_VALIDATED` (pré-fix) — script ops : `engine.queue(listingId)`.

### F4 — retrait `ChannelPublication` / `SalesChannel` morts-nés
- `schema.prisma` : suppression modèle `ChannelPublication`, relation `Listing.publications`,
  enum `SalesChannel` (delta non commité du 2026-07-11 — retiré du working tree).
- Migration untracked `20260711191009_channel_publication_pivot/` supprimée.
- `packages/core/src/generated/enums.ts` régénéré (SalesChannel disparaît).
- DB dev : `DROP TABLE IF EXISTS "ChannelPublication"; DROP TYPE IF EXISTS "SalesChannel";
  DELETE FROM "_prisma_migrations" WHERE migration_name='20260711191009_channel_publication_pivot';`
  (idempotent — appliqué si la migration avait été jouée localement).
- Le pivot multi-canal reviendra **avec son ADR et son premier consommateur** dans le même lot.

### F5 — enum `Marketplace` SSOT dans `@flipsync/core`
L'enum vit dans `core/types/marketplace.ts` ; `@flipsync/marketplace` la ré-exporte.
`MarketplaceId = \`${Marketplace}\`` (union littérale dérivée, zéro impact mobile).
Le miroir manuel disparaît.

## Prompts séquencés — findings restants

### [F2] (Sonnet — APRÈS décision produit)
> CONTEXTE : FlipSync, `packages/wallet/src/wallet.service.ts:101-112`. `requiresAutoRecharge`
> est produit mais consommé nulle part (grep). Décision Maxime : (a) implémenter le
> déclenchement réel de recharge Stripe quand `authorize()` le signale, ou (b) retirer la
> branche 3 (autoRecharge) et le champ du contrat `ListingAuthResult` jusqu'à implémentation.
> Si (b) : retirer aussi le `walletBalanceAfter` projeté mensonger. Tests wallet à jour.
> GATE : `authorize()` ne doit jamais retourner `authorized:true` sans garantie de débit
> ultérieur possible. Commit : `fix(wallet): … [F2]`.

### [F3] (Sonnet)
> CONTEXTE : `packages/ai/src/listing-engine.ts:46-50`. Retirer `PUBLISHED` de
> `EDITABLE_STATUSES` (l'édition post-publication ne se propage pas à la marketplace →
> dérive prix local↔en ligne). Adapter le message d'erreur (`LISTING_NOT_EDITABLE`) et les
> tests. Mobile : l'écran d'édition doit désactiver l'action sur listing publié (vérifier
> `apps/mobile/app/listing-edit.tsx`). Commit : `fix(listing): … [F3]`.

### [F6] (Sonnet)
> CONTEXTE : `packages/core/src/types/negotiation.ts:127,171` + `negotiation.service.ts`.
> `MISSION_FINALIZED` et `EXPIRED` ne sont jamais émis. Implémenter : (1) clôture
> `VENDU → MISSION_TERMINEE` (action vendeur écran S6 ou auto après vente confirmée),
> (2) expiration `EN_VENTE/NEGOCIATION_ACTIVE → EXPIREE` (déclencheur à définir — pas de
> cron existant : proposer le mécanisme le plus simple, YAGNI). Événements timeline +
> tests flow. Commit : `feat(mission): … [F6]`.

### [F7] (Sonnet)
> CONTEXTE : `apps/mobile/src/services/api.ts:69-172` recopie les payloads API
> (`ApiListing`, `ApiMission`, `ApiWallet`…) au lieu d'importer `@flipsync/core` (règle
> TECH_GOVERNANCE « types partagés »). Définir les DTO wire dans
> `packages/core/src/types/` (projections explicites, PAS le modèle Prisma brut), les
> faire renvoyer par les routes API, les importer côté mobile. Supprimer les interfaces
> locales. Typecheck api + mobile. Commit : `refactor(core): … [F7]`.

### [F8] (Haiku — mécanique)
> CONTEXTE : pivot IA serveur (ADR-003). Purger les mentions « on-device » périmées :
> `packages/ai/src/vision.ts:6,10-15,117-125` (commentaires + défaut
> `AI_INFERENCE_TIMEOUT_MS=15_000` + défaut `model='moondream2'` → aligner sur qwen/120s),
> `apps/api/src/routes/listing.ts:47-49,193-195` (commentaires), `.cursorrules:56,63`,
> `README.md:16,114`, `.env.example:13`. AUCUN changement de comportement runtime
> (les défauts morts deviennent les valeurs réellement injectées). Commit : `docs(ai): … [F8]`.

### [F9] (Haiku — mécanique)
> CONTEXTE : `packages/wallet/src/wallet.service.ts:137-138`. Remplacer
> `nextResetAt.setMonth(getMonth()+1)` par un calcul sans débordement (ancrage 1er du mois
> suivant : `setDate(1)` avant `setMonth(+1)`, conserver l'heure). Test unitaire cas
> 31 janvier. Commit : `fix(wallet): … [F9]`.
