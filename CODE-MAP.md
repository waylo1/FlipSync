# CODE-MAP — FlipSync (GATE-0, relevé du 2026-07-12)

> Carte canonique établie par lecture du code réel (anti-F1). Chaque assertion est ancrée
> `fichier:ligne`. Ce qui n'a pas été lu est marqué **[non lu — Phase 1]**.

## 1. Monorepo

Turborepo + npm workspaces. Racine : `package.json`, `turbo.json`, `Dockerfile` (API), `app.json` (Expo).

| Workspace | Nom | Rôle | Entrypoint |
|---|---|---|---|
| `apps/api` | `@flipsync/api` | Fastify 4 + TS, toutes routes | `src/index.ts` → `buildApp()` (`src/app.ts:21`) |
| `apps/mobile` | `@flipsync/mobile` | React Native + Expo Router | `app/_layout.tsx` (file-based) |
| `apps/web` | `@flipsync/web` | Console admin Vite (locale/dev, token inliné) | `src/main.tsx` |
| `packages/core` | `@flipsync/core` | **SSOT types purs** (zéro dép runtime) | `src/index.ts` |
| `packages/db` | `@flipsync/db` | Prisma 5 + PostgreSQL | `src/index.ts` (client) |
| `packages/wallet` | `@flipsync/wallet` | WalletService (centimes Int) | `src/index.ts` |
| `packages/ai` | `@flipsync/ai` | VisionService (Ollama) + ListingEngine (state machine) | `src/index.ts` |
| `packages/marketplace` | `@flipsync/marketplace` | Connecteurs publication | `src/index.ts` |

Packages internes : `main`/`types` → `dist/`, build `tsc -b` obligatoire avant exécution.

## 2. Routes API (enregistrées dans `apps/api/src/app.ts:62-71`)

| Préfixe | Fichier | Notes |
|---|---|---|
| `/health` | `app.ts:48` | seule route publique |
| `/uploads/*` | `app.ts:55-58` | static protégé JWT (photos) |
| `/auth` | `routes/auth.ts` | magic link + dev-token (hors prod) |
| `/wallet` | `routes/wallet.ts` | |
| `/listing` | `routes/listing.ts` | + upload photos, publish |
| `/stripe` | `routes/stripe.ts` | webhook (signature, pas JWT) |
| `/ai` | `routes/ai.ts` | draft/start + poll (DraftJob) |
| `/admin` | `routes/admin.ts` | gate ADMIN_EMAILS |
| `/dev-sessions` | `routes/dev-sessions.ts` | diagnostic dev, jamais prod |
| `/marketplace` | `routes/marketplace.ts` | status connexions |
| `/mission` | `routes/mission.ts` | Commissaire-Priseur IA |
| `/notifications` | `routes/notification.ts` | device tokens Expo |

Plugins : `plugins/auth.ts` (JWT → `req.userId`), `plugins/services.ts` (injection), `plugins/error-handler.ts`, `plugins/metrics.ts`.

Services API : `email`, `magic-link`, `health`, `dev-actions`, `dev-sessions`, `dev-session-export`, `marketplace-auth`, `publication`, `mission`, `negotiation`, `notification` (`apps/api/src/services/`). **[non lus — Phase 1]**

## 3. Boundaries API externes — RÉELLES vs DÉCLARÉES

| Boundary | Réalité code | Ancrage |
|---|---|---|
| **Stripe** | Webhook + recharges wallet. Idempotence par `stripeId @unique` | `schema.prisma:53`, `routes/stripe.ts` |
| **Ollama** (IA vision) | `OllamaVisionBackend`, dev qwen2.5vl:3b | `packages/ai/src/vision.ts` |
| **Vinted / Leboncoin** | Connecteurs squelettes, credentials env absents → `MARKETPLACE_CREDENTIALS_MISSING`. Enum `Marketplace = LEBONCOIN\|VINTED` | `packages/marketplace/src/types.ts:4-7`, `env.ts:50-54` |
| **Expo Push** | Notifications missions | `services/notification.service.ts`, `DeviceToken` (`schema.prisma:238-245`) |
| **Email** (magic link) | EmailService injectable, fallback console en dev | `services/email.service.ts`, `env.ts:29-30` |
| **eBay / Shopify / Rakuten** | ⚠️ **DB uniquement.** Enum `SalesChannel` (`schema.prisma:272-276`) + table `ChannelPublication` (`schema.prisma:116-133`) + migration `20260711191009`. **Zéro consommateur code** (grep `ChannelPublication` → schema + migration seulement). Pivot « Lot 1 » posé 2026-07-11, **non commité** |

Mock : `connectors/mock.ts` via `MARKETPLACE_MOCK=1` (jamais prod — à vérifier Phase 1).

## 4. DTOs partagés (`packages/core/src/`)

- `types/` : `wallet`, `listing` (TIER_PHOTO_COUNT, TIER_FEATURES), `mission`, `marketplace` (`MarketplaceId = 'VINTED'|'LEBONCOIN'` — `types/marketplace.ts:9`), `admin`, `negotiation`, `notification`, `dev-sessions`.
- `generated/enums.ts` : enums TS générés depuis `schema.prisma` (script `generate-enums.mjs`) — SSOT Prisma.
- Contrat connecteurs : `ListingPayload`, `MarketplaceCredentials`, `PublishResult = {ok:true; externalId; url} | {ok:false; code}` (`packages/marketplace/src/types.ts:13-47`).
- ❌ **`UnifiedListing` / union `fixed|auction` : INEXISTANT** (grep insensible casse → 0 résultat). Hypothèse du cadre écartée.

## 5. Gates fail-fast identifiés (surface — vérification Phase 1)

| Gate | Mécanisme | Ancrage |
|---|---|---|
| Env au boot | Zod `safeParse` → throw `ENV_VALIDATION_FAILED`, prod-only via `prodOnly()` | `env.ts:19-76` |
| Auth | JWT sur tout sauf `/health`, webhook Stripe, dev-token | `app.ts:47-61`, `plugins/auth.ts` |
| Admin | `ADMIN_EMAILS` CSV, vide = fail-closed | `env.ts:41` |
| Missions Premium | `PREMIUM_MISSION_ENABLED` OFF par défaut y compris prod | `env.ts:63-66` |
| CORS | whitelist prod, ouvert hors prod | `app.ts:35-41` |
| Stripe | signature `constructEvent()` (à vérifier) | `routes/stripe.ts` |
| Uploads | sha256 vérifié serveur (à vérifier) | `routes/listing.ts` |

## 6. State machines

| Machine | États | Où |
|---|---|---|
| `ListingStatus` | 11 (PENDING_AUTH → … → PUBLISHED / EXPIRED) | `schema.prisma:278-290` ; transitions : `packages/ai/src/transitions.ts` + `listing-engine.ts` |
| `MissionStatus` | 9 (BROUILLON_MANDAT → EN_VENTE → … → MISSION_TERMINEE) | `schema.prisma:324-334` ; logique : `services/mission.service.ts` + `negotiation.service.ts` |
| `DraftJobStatus` | RUNNING/READY/FAILED — persisté DB (ADR-005), découplé du Listing | `schema.prisma:204-218` |
| `ChannelPublication.status` | String `'QUEUED'\|'PUBLISHED'\|'FAILED'\|'RETRACTED'` — Zod annoncé, **aucun code ne l'écrit** | `schema.prisma:120` |

Double vérité publication (transition en cours) : colonnes legacy `publishedLbc/publishedVinted/lbcUrl/vintedUrl` (`schema.prisma:86-89`) **restent la source de vérité** ; `ChannelPublication` vide de tout backfill (migration:32-37).

## 7. Flux argent (VRAI risque financier)

- `UserWallet.balance` centimes Int, `WalletTransaction` (`schema.prisma:29-61`).
- `WalletService` : authorize (FREE_CREDIT → WALLET → TRIGGER_RECHARGE → BLOCKED), commit après USER_VALIDATED, remboursement auto AI_FAILED / PUBLISH_FAILED. `prisma.$transaction()` requis pour tout débit. **[implémentation non lue — Phase 1]** (`packages/wallet/src/wallet.service.ts`).
- Mission : `prixAffiche/prixMini/bestOfferAmount/soldAmount` en centimes (`schema.prisma:151-170`) — canal **simulé** (pas d'argent réel en face pour l'instant).

## 8. État non commité (delta HEAD)

| Fichier | Delta | Nature |
|---|---|---|
| `packages/db/prisma/schema.prisma` | +38 | `SalesChannel` + `ChannelPublication` (pivot Lot 1) |
| `CLAUDE.md` | +64 | non lu en diff — probable section pivot |
| `packages/ai/package.json` | +2 | non lu |
| `migrations/20260711191009_channel_publication_pivot/` | untracked | migration du pivot |
| `patches/@expo+cli+0.18.31.patch` | untracked | patch outillage Expo |

## 9. Docs de gouvernance présentes

`TECH_GOVERNANCE.md`, `docs/adr/ADR-001…008`, `COMMISSAIRE_PRISEUR_PLAN.md`, `OBSERVABILITY_PLAN.md`, `OFFERS_REFONTE_PLAN.md`, `DISTRIBUTION.md`, `FRONTEND.md`, `flipsync-fe-contract.md`, `ROADMAP_2_6_MONTHS.md`, `UI_POLISH_PLAN.md`. — Non-autoritatives pour l'audit (le code prime).

## 10. Divergences carte vs cadre d'audit (anti-F1 appliqué au cadre)

1. `UnifiedListing fixed|auction` : n'existe pas → Axe B recalibré sur les unions réelles (`PublishResult`, statuts Zod-String, `NegotiationAction`).
2. eBay/Shopify/Rakuten : boundary **déclarée en DB, sans aucun code**. L'Axe E porte sur les boundaries effectives : Stripe, Ollama, Vinted/LBC (squelettes), Expo Push, Email.
3. `@flipsync/shared` n'existe pas ; le SSOT types est `@flipsync/core` (+ `generated/enums.ts` dérivés Prisma) — l'Axe A vérifie son étanchéité réelle.
