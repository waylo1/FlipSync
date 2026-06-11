# FlipSync — Distribution & Release

Deux artefacts à distribuer : l'**app mobile** (EAS Build → stores) et l'**API**
(image Docker → hébergeur conteneur). L'app pointe vers l'API via
`EXPO_PUBLIC_API_URL`, injecté par profil de build.

---

## 1. Prérequis (one-time)

### Compte Expo / EAS
```bash
npm i -g eas-cli
eas login
cd apps/mobile
eas init            # crée le projet EAS → renseigne extra.eas.projectId + updates.url
```
Remplacer ensuite les placeholders dans `apps/mobile/app.json` :
- `owner` → handle du compte Expo
- `extra.eas.projectId` et `updates.url` (`https://u.expo.dev/<projectId>`) → valeurs de `eas init`

### Secrets de build (EAS)
```bash
eas secret:create --name JWT_SECRET --value "<32+ chars>"   # si un build en a besoin
```
Le compte de service Google Play (`secrets/play-service-account.json`) et les
identifiants Apple (`eas.json > submit.production.ios`) sont à renseigner pour `eas submit`.

---

## 2. App mobile — EAS Build

Profils (`apps/mobile/eas.json`) :

| Profil        | Distribution | API (`EXPO_PUBLIC_API_URL`)      | Sortie         |
|---------------|--------------|----------------------------------|----------------|
| `development` | interne      | `http://10.0.2.2:3001` (émulateur) | APK dev-client |
| `preview`     | interne      | `https://api-staging.flipsync.fr` | APK            |
| `production`  | store        | `https://api.flipsync.fr`        | AAB / IPA      |

```bash
cd apps/mobile
eas build --profile preview     --platform android      # test interne
eas build --profile production  --platform all          # store
eas submit --profile production --platform android       # → Play Console (track internal)
```

### Mises à jour OTA (JS only)
`runtimeVersion.policy = "fingerprint"` : une modif **JS** part en OTA ; une modif
**native** (nouveau module, bump SDK) impose un nouveau build (le fingerprint change).
```bash
eas update --channel production --message "fix écran validation"
```
Le canal (`channel`) de chaque profil de build mappe les updates aux bonnes installs.

---

## 3. API — image Docker

`Dockerfile` (racine) : multi-stage via `turbo prune @flipsync/api --docker`
(l'image n'embarque que l'API + core/db/wallet/ai/marketplace, jamais le mobile).
Client Prisma généré pour `debian-openssl-3.0.x` (cf. `binaryTargets`).

```bash
docker build -t flipsync-api:latest .
docker run --rm -p 3001:3001 --env-file .env.production flipsync-api:latest
```

Variables d'environnement requises en production (cf. `.env.example`) :
- `DATABASE_URL`, `DIRECT_URL` (Supabase EU)
- `JWT_SECRET` (≥ 32 caractères)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `EMAIL_API_KEY`, `EMAIL_FROM` (sinon les magic links ne partent pas — fallback console)
- `MAGIC_LINK_REDIRECT_URL` (deep link app), `PUBLIC_BASE_URL` (URLs photos absolues)
- `VINTED_ACCESS_TOKEN` / `LEBONCOIN_ACCESS_TOKEN` (sinon `PUBLISH_FAILED` + remboursement)
- `NODE_ENV=production` (désactive `/auth/dev-token`)

Migrations : `prisma migrate deploy` s'exécute au démarrage du conteneur
(mono-instance). En multi-instance, déplacer cette commande dans un **job de
release** dédié pour éviter les courses, et retirer du `CMD`.

Healthcheck : `GET /health` (seule route publique, sans JWT).

### Staging local en une commande (docker-compose.yml)

API + Postgres, migrations appliquées automatiquement au boot, healthchecks :
```bash
docker compose up --build -d --wait     # attend que les 2 services soient healthy
curl http://localhost:3001/health
docker compose down                     # -v pour effacer aussi la base
```
`NODE_ENV=development` par défaut (→ `/auth/dev-token` dispo pour tester). Postgres
exposé sur le port hôte 5434 (évite le conflit avec le conteneur de dev 5433).
Toutes les variables ont des défauts ; surcharger via un `.env` dans le dossier.

---

## 4. CI/CD (GitHub Actions)

| Workflow | Déclencheur | Rôle |
|----------|-------------|------|
| `.github/workflows/ci.yml` | push `main`, toute PR | npm ci → prisma generate/migrate (service Postgres) → `turbo build test typecheck` |
| `.github/workflows/release.yml` | tag `v*` | build & push image API sur GHCR + (opt-in) build mobile EAS |

**Secrets / variables de repo à configurer :**
- `GITHUB_TOKEN` — automatique, aucune action (push image sur `ghcr.io/<owner>/<repo>-api`).
- `EXPO_TOKEN` (secret) + `ENABLE_EAS=true` (variable) — pour activer le job mobile
  EAS. Tant que la variable n'est pas posée, le job est **sauté** (pas d'échec).

Release type :
```bash
git tag v0.1.0 && git push --tags     # → image GHCR + build EAS si activé
```

## 5. Checklist de release

- [ ] `npx turbo run build test` au vert
- [ ] Bump `version` dans `apps/mobile/app.json` (les build numbers natifs sont
      gérés par EAS — `appVersionSource: remote` + `autoIncrement`)
- [ ] API déployée et joignable sur l'URL du profil cible AVANT le build mobile
- [ ] `NODE_ENV=production` côté API (coupe `/auth/dev-token`)
- [ ] Provider email configuré (sinon connexion impossible en prod)
- [ ] Webhook Stripe pointé sur `https://<api>/stripe/webhook`
- [ ] `eas build --profile production` puis `eas submit`
