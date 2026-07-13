# FlipSync

Conciergerie de revente automatisée multi-plateformes (**Leboncoin**, **Vinted**).
L'utilisateur photographie un objet : l'IA **côté serveur** rédige l'annonce,
il valide le prix, et la publication part vers les marketplaces via leurs **APIs
partenaires officielles**. Paiement à l'usage via un wallet interne (centimes).

> Monorepo Turborepo + npm workspaces · TypeScript strict · finance en centimes `Int`.

---

## Architecture

```
┌─────────────────────────── apps/mobile (Expo / React Native) ───────────────────────────┐
│  Capture photo ─► envoi API (POST /ai/draft/start) ─► poll ─► brouillon                    │
│       │                                                  │                                │
│       ▼                                                  ▼                                │
│  upload photos (sha256)                       Écran validation (édition + diplomatie 120%)│
└───────────────────────────────────────┬──────────────────────────────────────────────────┘
                                         │  HTTPS (JWT / magic link)
┌────────────────────────────────────────▼─────────────── apps/api (Fastify) ──────────────┐
│  Auth (magic link)   Wallet $transaction    ListingEngine (machine à 11 états)            │
│        │                   │                          │                                   │
│        │            authorize/commit/refund/recharge  │  QUEUED ─► publish                │
│        │                   │                          ▼                                   │
│   Stripe webhook ──────────┘            MarketplaceClient ─► Vinted / Leboncoin (officiel) │
│   (recharge wallet)                          échec ─► PUBLISH_FAILED + remboursement auto  │
└────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                         │  Prisma 5
                                  PostgreSQL (Supabase EU)
```

### Packages (`packages/*`)

| Package | Rôle |
|---|---|
| `@flipsync/core` | Types partagés + helpers centimes (`centsToEur` / `eurToCents`) |
| `@flipsync/db` | Schéma Prisma + client + migrations |
| `@flipsync/wallet` | `WalletService` : authorize / commit / refund / recharge (atomique) |
| `@flipsync/ai` | `ListingEngine` (machine à états) + `VisionService` |
| `@flipsync/marketplace` | `MarketplaceClient` + connecteurs officiels Vinted / Leboncoin |

### Machine à états `ListingStatus` (11 états)

```
PENDING_AUTH → AUTHORIZED → AI_PROCESSING → DRAFT_READY → USER_VALIDATED → QUEUED → PUBLISHED
                                  ↓                              ↓
                              AI_FAILED                  USER_CANCELLED   PUBLISH_FAILED → EXPIRED
```
Le débit wallet a lieu **uniquement** à `USER_VALIDATED`. Tout `*_FAILED` rembourse
automatiquement. Aucun faux succès : sans accord partenaire, la publication échoue
proprement en `PUBLISH_FAILED`.

---

## Quickstart (dev local)

Prérequis : **Node ≥ 20**, **Docker**.

```bash
npm install

# Base de données (staging local : API + Postgres en une commande)
docker compose up --build -d --wait
curl http://localhost:3001/health        # {"status":"ok",...}

# … ou Postgres seul + API en hot-reload :
#   docker run -d --name flipsync-pg -e POSTGRES_USER=flipsync \
#     -e POSTGRES_PASSWORD=flipsync -e POSTGRES_DB=flipsync -p 5433:5432 postgres:16
#   cp .env.example .env   # renseigner DATABASE_URL/DIRECT_URL (port 5433)
#   npm run db:gen && npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
#   npm run dev

# Mobile
cd apps/mobile && npx expo run:android   # device/émulateur — voir DISTRIBUTION.md
```

### Commandes monorepo

```bash
npm run build      # turbo run build (tous les packages)
npm run test       # 76 tests Vitest (e2e sur Postgres réel)
npm run db:gen     # prisma generate
```

Convention **non négociable** : tout montant est un `Int` en **centimes**
(`1000` = 10,00 €). Jamais de `Float` monétaire. Détails dans [`.cursorrules`](.cursorrules)
et [`CLAUDE.md`](CLAUDE.md).

---

## Distribution & production

Build mobile (EAS), image API (Docker / GHCR), CI/CD (GitHub Actions) et runbook
complet : voir **[DISTRIBUTION.md](DISTRIBUTION.md)**.

### Checklist mise en production

```
□ git push → GitHub               (déclenche ci.yml : build + test + typecheck)
□ Compte Expo → EXPO_TOKEN + variable ENABLE_EAS=true   (active le build mobile EAS)
□ Hébergeur API + DATABASE_URL prod  (+ JWT_SECRET, NODE_ENV=production, PUBLIC_BASE_URL)
□ Provider email (Resend)         (EMAIL_API_KEY + EMAIL_FROM — sinon pas de magic link)
□ git tag v0.1.0 && git push --tags   (release.yml → image GHCR + build EAS)
□ Accords partenaires Vinted Pro / LBC Partenaire   (seul bloquant non-technique)
```

---

## Stack

React Native + Expo Router · Fastify 4 · Prisma 5 / PostgreSQL · Zustand + MMKV ·
Zod · Stripe · Ollama (qwen2.5vl, serveur) · Turborepo · Vitest.
