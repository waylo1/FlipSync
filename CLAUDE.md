# FlipSync — CLAUDE.md

> Lis ce fichier EN ENTIER avant chaque session. Ne jamais demander le contexte projet, il est ici.

---

## Projet

**FlipSync** — Conciergerie de revente automatisée multi-plateformes (Leboncoin, Vinted).
Solo founder : Maxime. Tu es son architecte senior et exécutant technique.
Stack décidée, schéma validé. Ne propose pas de refonte architecture sans raison critique.

---

## Stack

| Couche | Technologie |
|---|---|
| Mobile | React Native + Expo (bare workflow) |
| Router | Expo Router (file-based) |
| Backend | Fastify 4 + TypeScript |
| ORM | Prisma 5 + PostgreSQL (Supabase EU) |
| Auth | JWT via @fastify/jwt |
| Paiement | Stripe (wallet interne, centimes) |
| IA vision (serveur) | Ollama qwen2.5vl:3b en dev — POST /ai/draft (prod : GPU/API hébergée) |
| Monorepo | Turborepo + npm workspaces |
| State mobile | Zustand + MMKV |
| Validation | Zod |

---

## Structure monorepo

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
├── CLAUDE.md
└── .claude/
```

---

## Conventions critiques — NE JAMAIS DÉROGER

### Finance
- TOUJOURS stocker en centimes (Int). Jamais Float pour l'argent.
- balance: Int = centimes. 1000 = 10,00€
- Helpers : centsToEur(cents) / eurToCents(eur)
- Stripe attend des centimes nativement

### TypeScript
- strict: true partout
- Pas de any. Jamais.
- Enums TypeScript = miroir exact des enums Prisma

### API
- Toutes les routes protégées JWT sauf /health
- req.userId injecté par authPlugin
- Erreurs : { error: 'SNAKE_CASE_CODE' }

### Mobile
- Inférence IA = côté serveur FlipSync (POST /ai/draft, JWT). PIVOT 2026-07-07 :
  l'on-device (llama.rn + Moondream2) est abandonné — modèle trop faible pour
  rédiger un JSON français + 2 Go à télécharger par user. Jamais d'IA tierce
  appelée depuis le mobile ; le mobile ne parle qu'à l'API FlipSync.
- Images listées avec sha256

---

## Modèle économique

| Service | Centimes |
|---|---|
| Listing SIMPLE | 80 |
| Listing OPTIMIZED | 250 |
| Listing PREMIUM | 300 |
| Gestion Active /mois | 100 |
| Free tier | 3 listings/mois |
| Bonus fidélité | +100 (1ère recharge ≥1000) |

Pas de commission sur ventes. Frais de service uniquement.

---

## Machine à états ListingStatus

PENDING_AUTH → AUTHORIZED → AI_PROCESSING → DRAFT_READY → USER_VALIDATED → QUEUED → PUBLISHED
                                  ↓                              ↓
                              AI_FAILED                   USER_CANCELLED → PUBLISH_FAILED → EXPIRED

- failureReason toujours renseigné sur *_FAILED
- Remboursement wallet auto sur AI_FAILED et PUBLISH_FAILED

---

## WalletService authorize()

1. freeListingsRemaining > 0 → FREE_CREDIT
2. balance >= cost → WALLET
3. autoRechargeEnabled → TRIGGER_RECHARGE → WALLET
4. sinon → BLOCKED

commit() s'exécute APRÈS USER_VALIDATED — jamais à l'autorisation.

---

## Publication marketplace — 100% APIs partenaires officielles

- Connecteurs sanctionnés : Vinted Integrations/Pro, Leboncoin Partenaire
  (direct ou agrégateur Lengow). PAS d'automatisation UI, PAS de contournement.
- Logique 100% serveur : package @flipsync/marketplace (MarketplaceClient + connecteurs).
- Le brouillon IA serveur (POST /ai/draft) alimente le payload via l'API (POST /listing/:id/publish).
- Échec → PUBLISH_FAILED + remboursement wallet automatique.
- Décision : modules AccessibilityService/stealth Android supprimés (pivot conformité).

---

## Commandes

npm run dev          # Lance tout
npm run db:push      # Push schema
npm run db:gen       # Génère client Prisma
npm run build        # Build tout
npm run test         # Tests

## Distribution (cf. DISTRIBUTION.md)

Mobile : EAS Build (apps/mobile/eas.json — profils development/preview/production),
OTA via expo-updates (runtimeVersion fingerprint), env API par profil.
API : Dockerfile racine (turbo prune @flipsync/api, mobile exclu), migrate deploy au boot.
Placeholders à renseigner : app.json owner/projectId/updates.url (via `eas init`),
eas.json submit (Apple/Play).

---

## Gotchas

- prisma.$transaction() obligatoire pour tout débit wallet
- llama.rn nécessite expo prebuild avant run:android
- AccessibilityService = activation manuelle user dans Paramètres Android
- iOS keyboard extension = App Group partagé obligatoire
- Stripe webhook : vérifier signature constructEvent() — ne pas skip en dev

---

## Sprint 1 — État

- [x] Monorepo Turborepo
- [x] Schéma Prisma (centimes, ListingStatus complet)
- [x] Types TypeScript core
- [x] AuthMiddleware Fastify
- [x] WalletService + tests
- [x] ListingEngine state machine
- [x] Routes API wallet
- [x] Routes API listing
- [x] Stripe webhook handler
- [x] Vision module Moondream2 (validation device réelle à faire)

---

## Sprint 2 — État

- [x] Provisioning GGUF mobile (download + manifest intégrité + bootstrap)
      ⚠️ Quantisation : Q4_K public (salivosa/moondream2-gguf, ~919 MB, génération
      2024-04) + mmproj f16 officiel APPARIÉ (moondream/moondream2-gguf, ~910 MB)
      → ~1,83 GB. Aucun mmproj quantisé public. Consentement download (~2 Go) requis
      dans l'UI. SSOT : MODEL_REGISTRY (apps/mobile/src/services/model-files.ts).
- [x] Écran capture (vision-camera → resize 768px → base64+sha256 → analyze())
- [x] Écran validation draft (édition, diplomatie 120%, create→ai-start→draft→validate)
- [x] Routes API pipeline IA mobile (ai-start / draft / ai-failed)
- [x] Upload photos (POST /listing/:id/photos, sha256 du base64 vérifié serveur)
- [x] Auth dev (/auth/dev-token absent en prod + écran login + garde (tabs))
- [x] expo prebuild android (manifest CAMERA ok, applicationId fr.flipsync.app)
- [x] IP locale configurée (apps/mobile/.env → EXPO_PUBLIC_API_URL)
- [ ] Validation inférence sur device réel — BLOQUÉ sur cette machine :
      ni Android SDK, ni JDK, ni adb. Installer Android Studio + JDK 17,
      brancher le device (USB debugging), puis npx expo run:android.
- [~] ABANDONNÉ — modules AccessibilityService/stealth Android supprimés.
      Pivot conformité : publication via APIs partenaires officielles (voir ci-dessous).

---

## Sprint 3 — Pivot connecteurs marketplace (APIs officielles)

- [x] Suppression totale stealth (native/android, plugin Expo, bridge RN, hooks)
- [x] Package @flipsync/marketplace : Publisher + MarketplaceClient + connecteurs
      (VintedProConnector, LeboncoinPartnerConnector) — squelettes endpoints officiels
- [x] Publication serveur : POST /listing/:id/publish → MarketplaceClient
      → markPublished / failPublish (remboursement auto)
- [ ] Credentials partenaires réels (OAuth Vinted Integrations, clé LBC Partenaire)
      — en attente d'accès programme partenaire ; connecteurs lèvent
      MARKETPLACE_CREDENTIALS_MISSING tant que non configurés
- [x] Auth production (magic link : POST /auth/magic-link + /auth/verify,
      token hashé sha256 usage unique + TTL, anti-énumération, EmailService
      injectable ; mobile login + écran deep link /auth/verify). dev-token gardé hors prod.
- [x] Mock pipeline serveur : MockMarketplacePublisher (MARKETPLACE_MOCK=1, jamais prod)
      + apps/api/tools/test-pipeline.ts (flux mobile complet → debug/publish_log.json)
- [x] Enums générés depuis schema.prisma (packages/core/scripts/generate-enums.mjs)
      — duplication manuelle supprimée, SSOT Prisma
- [x] UI mobile « Vide-Grenier » : tokens theme.ts (palette/space/radius/shadow/motion),
      primitives src/ui/, composés src/components/, icônes lucide-react-native,
      a11y complète — plan FRONTEND.md, contrat flipsync-fe-contract.md, gates G1–G5
- [x] Branchement API mobile : listings + wallet + transactions (useApiResource :
      focus refetch, pull-to-refresh, skeletons, ErrorBanner ; auto-recharge en
      lecture seule — pas d'endpoint de mutation). Validé contre l'API locale (curl).
      Reste : validation visuelle sur device (npx expo run:android — machine avec SDK)

---

## Sprint 4 — Pivot IA serveur (2026-07-07)

- [x] ABANDON on-device : Moondream2 voit mais ne sait produire ni JSON ni français
      (validé sur device : sortie = caption anglaise). Fichiers mobile supprimés
      (useVision, vision.service, vision-bootstrap, model-files, model.store) ;
      _layout efface documentDirectory/models/ (~1,8 Go) au démarrage.
      llama.rn encore dans package.json — à retirer au prochain build EAS (APK plus léger).
- [x] POST /ai/draft (JWT, bodyLimit 12 Mo) : photos base64 → VisionService
      (OllamaVisionBackend, timeout 120 s, num_ctx 16384) → ListingDraft Zod.
      app.visionService injecté par services-plugin. Erreurs AI_* → 502/504.
- [x] Mobile : capture 768px (annonce) + downscale 512px de la SEULE 1ʳᵉ photo
      pour /ai/draft (encodage image ~40-90 s/photo sur CPU dev — GPU prod :
      passer les 3 premières). api.analyzeDraft timeout 150 s.
- [x] Dev : Ollama qwen2.5vl:3b sur le PC (OLLAMA_MODEL, .env racine). Validé
      curl : draft français complet en ~12 s (cache) / ~70 s (photo froide, CPU).
- [x] VALIDÉ SUR DEVICE (2026-07-07, en 5G via Tailscale 100.64.87.44) : pipeline
      complet photos → /ai/draft → validation → publish (QUEUED). Fixes au passage :
      POST sans corps → body '{}' (Fastify 400 sinon) ; nouvelle capture ⇒ cancel
      du pendingPublish obsolète (sinon mélange annonce/photos d'un autre objet).
- [ ] Prod : héberger l'inférence — décision en attente (Maxime) entre API hébergée
      (reco : Claude Haiku 4.5, ~0,5 c€/annonce, backend à ajouter dans packages/ai)
      et GPU loué avec Ollama (~30-80 €/mois). Qualité dev actuelle : objets parfois
      mal identifiés, prix sous-estimés — connu, assumé jusqu'à la décision.
