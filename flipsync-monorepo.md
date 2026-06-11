# FlipSync — Monorepo Sprint 1

## Structure

```
flipsync/
├── apps/
│   ├── mobile/
│   └── api/
├── packages/
│   ├── core/
│   ├── db/
│   ├── ai/
│   └── wallet/
├── turbo.json
├── package.json
├── tsconfig.base.json
└── .env.example
```

---

## `/package.json` (racine)

```json
{
  "name": "flipsync",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev":     "turbo run dev",
    "build":   "turbo run build",
    "test":    "turbo run test",
    "db:push": "turbo run db:push --filter=@flipsync/db",
    "db:gen":  "turbo run db:generate --filter=@flipsync/db"
  },
  "devDependencies": {
    "turbo":      "^2.0.0",
    "typescript": "^5.4.0",
    "prettier":   "^3.2.0",
    "@types/node": "^20.0.0"
  },
  "engines": { "node": ">=20.0.0" }
}
```

---

## `/turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "build":       { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev":         { "persistent": true, "cache": false },
    "test":        { "dependsOn": ["build"] },
    "db:generate": { "cache": false },
    "db:push":     { "cache": false }
  }
}
```

---

## `/tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target":           "ES2022",
    "module":           "commonjs",
    "lib":              ["ES2022"],
    "strict":           true,
    "esModuleInterop":  true,
    "skipLibCheck":     true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration":      true,
    "declarationMap":   true,
    "sourceMap":        true,
    "paths": {
      "@flipsync/core":   ["../../packages/core/src"],
      "@flipsync/db":     ["../../packages/db/src"],
      "@flipsync/ai":     ["../../packages/ai/src"],
      "@flipsync/wallet": ["../../packages/wallet/src"]
    }
  }
}
```

---

## `/.env.example`

```env
# Supabase
DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/flipsync"
DIRECT_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/flipsync"

# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Ollama (local dev)
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL="moondream2"

# API
API_PORT=3001
API_HOST="0.0.0.0"
JWT_SECRET="change-me-in-production"

# App
NODE_ENV="development"
```

---

## `packages/core/`

### `packages/core/package.json`

```json
{
  "name": "@flipsync/core",
  "version": "0.0.1",
  "main": "./src/index.ts",
  "scripts": { "build": "tsc -p tsconfig.json" },
  "devDependencies": { "typescript": "^5.4.0" }
}
```

### `packages/core/src/types/listing.ts`

```typescript
export enum ListingTier {
  SIMPLE    = 'SIMPLE',     // 0.80€
  OPTIMIZED = 'OPTIMIZED',  // 2.50€
  PREMIUM   = 'PREMIUM',    // 3.00€
}

export enum PaymentSource {
  FREE_CREDIT = 'FREE_CREDIT',
  WALLET      = 'WALLET',
  BLOCKED     = 'BLOCKED',
}

export enum ListingStatus {
  PENDING_AUTH   = 'PENDING_AUTH',
  AUTHORIZED     = 'AUTHORIZED',
  AI_PROCESSING  = 'AI_PROCESSING',
  DRAFT_READY    = 'DRAFT_READY',
  USER_VALIDATED = 'USER_VALIDATED',
  QUEUED         = 'QUEUED',
  PUBLISHED      = 'PUBLISHED',
  FAILED         = 'FAILED',
}

export const TIER_PRICING: Record<ListingTier, number> = {
  [ListingTier.SIMPLE]:    0.80,
  [ListingTier.OPTIMIZED]: 2.50,
  [ListingTier.PREMIUM]:   3.00,
}

export interface ListingAuthResult {
  authorized:           boolean
  source:               PaymentSource
  cost:                 number
  freeCreditsRemaining: number
  walletBalanceBefore:  number
  walletBalanceAfter:   number
  requiresAutoRecharge: boolean
  deficit?:             number
}

export interface ListingDraft {
  titre:           string
  description:     string
  categorieLbc:    string
  categorieVinted: string
  etat:            'neuf' | 'tres_bon' | 'bon' | 'correct'
  prixPlancher:    number
  prixHaut:        number
  marque:          string | null
  confidence:      number  // 0-1, score IA
}

export interface ListingContext {
  listingId: string
  userId:    string
  tier:      ListingTier
  auth:      ListingAuthResult
  draft?:    ListingDraft
  status:    ListingStatus
  createdAt: Date
}
```

### `packages/core/src/types/wallet.ts`

```typescript
export enum TransactionType {
  CREDIT  = 'CREDIT',
  DEBIT   = 'DEBIT',
  BONUS   = 'BONUS',
  REFUND  = 'REFUND',
}

export interface WalletState {
  balance:               number
  freeListingsRemaining: number
  freeListingsResetAt:   Date
  autoRechargeEnabled:   boolean
  autoRechargeThreshold: number
  autoRechargeAmount:    number
  lifetimeRecharged:     number
}
```

### `packages/core/src/index.ts`

```typescript
export * from './types/listing'
export * from './types/wallet'
```

---

## `packages/db/`

### `packages/db/package.json`

```json
{
  "name": "@flipsync/db",
  "version": "0.0.1",
  "main": "./src/index.ts",
  "scripts": {
    "db:generate": "prisma generate",
    "db:push":     "prisma db push",
    "db:studio":   "prisma studio"
  },
  "dependencies": {
    "@prisma/client": "^5.14.0"
  },
  "devDependencies": {
    "prisma":     "^5.14.0",
    "typescript": "^5.4.0"
  }
}
```

### `packages/db/prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ─── USER ────────────────────────────────────────────────────────────────────

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  wallet   UserWallet?
  listings Listing[]
}

// ─── WALLET ──────────────────────────────────────────────────────────────────

model UserWallet {
  id                    String   @id @default(cuid())
  userId                String   @unique
  balance               Float    @default(0)
  freeListingsRemaining Int      @default(3)
  freeListingsResetAt   DateTime @default(dbgenerated("NOW() + INTERVAL '1 month'"))
  autoRechargeEnabled   Boolean  @default(false)
  autoRechargeThreshold Float    @default(1.0)
  autoRechargeAmount    Float    @default(10.0)
  lifetimeRecharged     Float    @default(0)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  user         User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions WalletTransaction[]
}

model WalletTransaction {
  id          String          @id @default(cuid())
  walletId    String
  type        TransactionType
  amount      Float
  source      PaymentSource
  listingId   String?
  stripeId    String?
  description String?
  createdAt   DateTime        @default(now())

  wallet  UserWallet @relation(fields: [walletId], references: [id])
  listing Listing?   @relation(fields: [listingId], references: [id])
}

// ─── LISTING ─────────────────────────────────────────────────────────────────

model Listing {
  id          String        @id @default(cuid())
  userId      String
  tier        ListingTier
  status      ListingStatus @default(PENDING_AUTH)
  paymentSource PaymentSource
  cost        Float

  // Données IA
  titre           String?
  description     String?
  categorieLbc    String?
  categorieVinted String?
  etat            ItemCondition?
  prixPlancher    Float?
  prixHaut        Float?
  prixPublie      Float?
  marque          String?
  confidence      Float?

  // Plateformes
  publishedLbc    Boolean  @default(false)
  publishedVinted Boolean  @default(false)
  lbcUrl          String?
  vintedUrl       String?

  // Prix overridé par user (>20% au-dessus → flag)
  isPriceFlagged  Boolean  @default(false)

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  publishedAt DateTime?

  user         User               @relation(fields: [userId], references: [id])
  photos       ListingPhoto[]
  transactions WalletTransaction[]
}

model ListingPhoto {
  id        String   @id @default(cuid())
  listingId String
  url       String
  order     Int      @default(0)
  sha256    String   // intégrité fichier
  createdAt DateTime @default(now())

  listing Listing @relation(fields: [listingId], references: [id], onDelete: Cascade)
}

// ─── ENUMS ───────────────────────────────────────────────────────────────────

enum ListingTier     { SIMPLE OPTIMIZED PREMIUM }
enum ListingStatus   { PENDING_AUTH AUTHORIZED AI_PROCESSING DRAFT_READY USER_VALIDATED QUEUED PUBLISHED FAILED }
enum PaymentSource   { FREE_CREDIT WALLET BLOCKED }
enum TransactionType { CREDIT DEBIT BONUS REFUND }
enum ItemCondition   { neuf tres_bon bon correct }
```

### `packages/db/src/index.ts`

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export * from '@prisma/client'
```

---

## `apps/api/`

### `apps/api/package.json`

```json
{
  "name": "@flipsync/api",
  "version": "0.0.1",
  "scripts": {
    "dev":   "ts-node-dev --respawn src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@flipsync/core":   "*",
    "@flipsync/db":     "*",
    "@flipsync/wallet": "*",
    "@flipsync/ai":     "*",
    "fastify":          "^4.27.0",
    "@fastify/cors":    "^9.0.0",
    "@fastify/jwt":     "^8.0.0",
    "stripe":           "^15.0.0",
    "zod":              "^3.23.0"
  },
  "devDependencies": {
    "typescript":    "^5.4.0",
    "ts-node-dev":   "^2.0.0",
    "@types/node":   "^20.0.0"
  }
}
```

### `apps/api/src/index.ts`

```typescript
import Fastify from 'fastify'
import cors    from '@fastify/cors'
import jwt     from '@fastify/jwt'

const app = Fastify({ logger: true })

app.register(cors, { origin: true })
app.register(jwt,  { secret: process.env.JWT_SECRET! })

// Routes
app.register(import('./routes/wallet'),  { prefix: '/wallet' })
app.register(import('./routes/listing'), { prefix: '/listing' })
app.register(import('./routes/stripe'),  { prefix: '/stripe' })

app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

app.listen({ port: Number(process.env.API_PORT ?? 3001), host: process.env.API_HOST ?? '0.0.0.0' })
  .then(addr => console.log(`FlipSync API → ${addr}`))
```

---

## `apps/mobile/`

### `apps/mobile/package.json`

```json
{
  "name": "@flipsync/mobile",
  "version": "0.0.1",
  "main": "expo-router/entry",
  "scripts": {
    "dev":     "expo start",
    "android": "expo run:android",
    "ios":     "expo run:ios",
    "build":   "eas build"
  },
  "dependencies": {
    "@flipsync/core":          "*",
    "expo":                    "~51.0.0",
    "expo-router":             "~3.5.0",
    "react-native":            "0.74.1",
    "react-native-vision-camera": "^4.5.0",
    "llama.rn":                "^0.9.0",
    "@stripe/stripe-react-native": "^0.38.0",
    "react-native-mmkv":       "^3.0.0",
    "zustand":                 "^4.5.0",
    "zod":                     "^3.23.0"
  },
  "devDependencies": {
    "typescript":  "^5.4.0",
    "@types/react": "^18.3.0"
  }
}
```

### `apps/mobile/src/` — Structure

```
src/
├── app/                          # Expo Router (file-based routing)
│   ├── (auth)/
│   │   └── login.tsx
│   ├── (tabs)/
│   │   ├── index.tsx             # Capture
│   │   ├── listings.tsx          # Suivi
│   │   └── wallet.tsx            # Wallet
│   └── _layout.tsx
├── components/
│   ├── ListingCard.tsx
│   ├── WalletBadge.tsx
│   └── PriceFlagAlert.tsx        # Alerte >20% au-dessus marché
├── hooks/
│   ├── useListing.ts
│   ├── useWallet.ts
│   └── useVision.ts              # Inférence Moondream2
├── services/
│   ├── api.ts                    # Client HTTP → API Fastify
│   └── vision.service.ts         # llama.rn wrapper
└── store/
    ├── listing.store.ts          # Zustand
    └── wallet.store.ts
```

---

## Commandes d'initialisation (Claude Code)

```bash
# 1. Init monorepo
mkdir flipsync && cd flipsync
git init

# 2. Install Turborepo
npx create-turbo@latest . --skip-install

# 3. Créer la structure packages
mkdir -p apps/mobile apps/api
mkdir -p packages/core/src/types packages/db/prisma packages/db/src
mkdir -p packages/ai/src packages/wallet/src

# 4. Copier tous les fichiers ci-dessus

# 5. Install dépendances
npm install

# 6. Générer Prisma
cd packages/db && npx prisma generate

# 7. Lancer en dev
cd ../.. && npm run dev
```

---

## Prompt Claude Code (à coller dans le terminal)

```
Initialise le monorepo FlipSync avec la structure exacte décrite dans
flipsync-monorepo.md. Crée tous les fichiers, installe les dépendances,
génère le client Prisma. Utilise npm workspaces + Turborepo.
Ne modifie pas le schéma Prisma. Utilise TypeScript strict partout.
```
