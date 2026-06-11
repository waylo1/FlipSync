# syntax=docker/dockerfile:1
# Image de production de l'API Fastify (@flipsync/api).
# Stratégie monorepo : turbo prune isole l'API + ses packages internes
# (core, db, wallet, ai, marketplace) — apps/mobile est exclu de l'image.

# ─── 1. Prune : périmètre minimal de l'API ──────────────────────────────────────
FROM node:20-slim AS pruner
WORKDIR /app
RUN npm install -g turbo@^2
COPY . .
RUN turbo prune @flipsync/api --docker

# ─── 2. Build : install (cache sur package.json) → prisma generate → tsc ─────────
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# Lockfile + package.json seuls d'abord : couche d'install mise en cache.
COPY --from=pruner /app/out/json/ .
RUN npm install
# Code source de tous les workspaces inclus.
COPY --from=pruner /app/out/full/ .
# tsconfig.base.json racine : non copié par `turbo prune`, mais référencé par
# chaque package via `extends: ../../tsconfig.base.json` → requis pour `tsc -b`.
COPY tsconfig.base.json ./tsconfig.base.json
# Client Prisma pour la cible Linux (binaryTargets debian).
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npx turbo build --filter=@flipsync/api

# ─── 3. Runner : image d'exécution ──────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3001
# Chemin de stockage des photos — explicite (sinon résolu vers cwd /app/uploads,
# non créable par l'utilisateur non-root). Aligné avec le volume docker-compose.
ENV UPLOAD_DIR=/app/apps/api/uploads

# Utilisateur non-root + dossier d'upload lui appartenant (un volume monté ici
# héritera de ces permissions à l'initialisation).
RUN groupadd -r flipsync && useradd -r -g flipsync flipsync
COPY --from=builder --chown=flipsync:flipsync /app .
RUN mkdir -p /app/apps/api/uploads && chown -R flipsync:flipsync /app/apps/api/uploads
USER flipsync

EXPOSE 3001
# Migrations appliquées au démarrage (déploiement mono-instance) puis lancement API.
# Multi-instance : sortir `prisma migrate deploy` dans un job de release dédié.
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/db/prisma/schema.prisma && node apps/api/dist/index.js"]
