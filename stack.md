# Stack FlipSync

## Mobile
- React Native 0.74 + Expo 51 (bare workflow)
- Expo Router 3.5 (file-based routing)
- Zustand (state global)
- MMKV (storage local rapide)
- llama.rn (inférence on-device)
- react-native-vision-camera (capture photo)
- @stripe/stripe-react-native

## Backend
- Fastify 4 + TypeScript
- @fastify/jwt (auth)
- @fastify/cors
- Zod (validation)

## Data
- Prisma 5
- PostgreSQL via Supabase EU
- Connexion : DATABASE_URL + DIRECT_URL

## Infrastructure
- Turborepo (monorepo)
- npm workspaces
- Node 20+

## Packages internes
- @flipsync/core — types partagés
- @flipsync/db — Prisma client
- @flipsync/ai — ListingEngine + Vision
- @flipsync/wallet — WalletService
