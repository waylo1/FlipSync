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
  ⚠ mono-canal historique (pré-pivot) — à N canaux, la règle de remboursement est une
  **Business Policy — hors Core** (cf. Doctrine multi-canal, D5), pas une règle du Core (ERRATA E-13)

---

## WalletService authorize()

1. freeListingsRemaining > 0 → FREE_CREDIT
2. balance >= cost → WALLET
3. autoRechargeEnabled → TRIGGER_RECHARGE → WALLET
4. sinon → BLOCKED

commit() s'exécute APRÈS USER_VALIDATED — jamais à l'autorisation.

---

## Publication marketplace — 100% APIs partenaires officielles

- Connecteurs sanctionnés : Vinted Integrations/Pro, Leboncoin Partenaire — transport agrégateur
  (ADAPTER-CONTRACT §4, capability matrix — donnée révisable, SSOT ; correction ERRATA E-16,
  remplace la mention historique « direct ou agrégateur Lengow »). PAS d'automatisation UI,
  PAS de contournement.
- Logique 100% serveur : package @flipsync/marketplace (MarketplaceClient + connecteurs).
- Le brouillon IA serveur (POST /ai/draft) alimente le payload via l'API (POST /listing/:id/publish).
- Échec → PUBLISH_FAILED + remboursement wallet automatique.
  ⚠ mono-canal historique (pré-pivot) — à N canaux, cf. Doctrine multi-canal / D5 : la règle de
  remboursement vit en Business Policy, hors Core (ERRATA E-13)
- Décision : modules AccessibilityService/stealth Android supprimés (pivot conformité).

---

## Doctrine multi-canal — Sessions Fable P1–P6 (2026-07-12/13)

> Cristallisation des décisions P1→P5 — AUCUN concept nouveau ici. Artefacts source (détail
> et preuves) : UNION-STRESS.md · ADAPTER-CONTRACT.md · THREAT-MODEL.md · SYNC-FSM.md ·
> INVARIANT-SPEC.md · MASTER-REMED.md · ERRATA.md → ERRATA-RESOLVED.md (audit adversarial +
> corrections de cohérence, 2026-07-13). Ces règles s'APPLIQUENT ; elles ne se modifient que
> par revue d'architecture (cf. Architecture Freeze ci-dessous).

### Règles

| Règle | Objectif | Protège | Vérification | Exception |
|---|---|---|---|---|
| **Fermeture du core** (CC-1/2) : un champ n'entre au core que s'il décrit l'objet physique ou le mandat du vendeur — jamais un canal ; aucun symbole du Core ne nomme une marketplace | Ajouter un canal sans toucher au domaine | Contre la re-création de L1 (`categorieLbc`) : 9 canaux = 9 colonnes, pour toujours | `/closure-check` (greps INVARIANT-SPEC §5, checks C-1/2) | La déclaration d'enum des canaux (schema.prisma + enums générés) |
| **Zéro branchement canal** (CC-3) : aucun `if`/`switch` sur un nom de canal hors `packages/marketplace` | Comportements par canal impossibles à disperser | La capability matrix comme unique vérité des différences | `/closure-check` (C-3, C-reg) | UNE énumération autorisée : le registre des connecteurs (composition root) |
| **Tout transite par le port + la matrix** (CC-4/5) : une différence de canal = une valeur de matrix OU du code dans UN connecteur ; un canal s'ajoute en 5 étapes (ADAPTER-CONTRACT §12), zéro modif core | Canal N+1 à coût constant | La fermeture prouvable par le diff | `/pr-canal` : fichiers touchés ⊆ enum + `packages/marketplace/**` + config | Aucune — une 6ᵉ étape nécessaire = revue d'architecture |
| **Taxonomie canonique** (CC-6) : le prompt IA produit `CanonicalCategory` ; les référentiels de catégories par canal vivent dans les connecteurs | Un seul prompt, un seul vocabulaire core | L1 côté IA (un prompt par canal) | `/closure-check` (grep canaux sur `packages/ai`) | Aucune |
| **UI pilotée par l'API** (CC-7) : liste des canaux, éligibilité (precheck), états = données renvoyées par l'API ; aucune logique canal dans mobile/web | Zéro écran modifié par canal | La fermeture côté client | `/closure-check` (grep `apps/mobile`, `apps/web`) | Mapping présentationnel id → logo/couleur (la LISTE vient de l'API) |
| **Wallet intouchable** (INV-9) : `packages/marketplace` n'importe jamais le wallet ; remboursements uniquement via ListingEngine | Un connecteur ne peut pas créer de mouvement d'argent | L'argent réel des users | `/closure-check` (C-09, grep imports) | Aucune |
| **Business Policy — hors Core** (D5) : facturation, remboursement, compensation lisent les FAITS (vue agrégée SYNC-FSM §7 : `PARTIAL_SUCCESS`…) — jamais l'inverse ; aucune règle d'argent dans contrat/FSM/connecteurs | Changer une règle métier sans toucher au domaine | Contre la fossilisation d'une règle d'argent dans la machine (les faits peuvent évoluer après coup) | Aucun import Billing dans marketplace/FSM ; revue | Aucune |
| **Une seule FSM stockée** : `ChannelPublication.status` par (listing, canal) + fait vente set-once ; la vue agrégée est une fonction pure, JAMAIS stockée | Une seule vérité de sync | Contre la double vérité qui dérive (leçon F3) | Revue schéma : aucun statut agrégé persisté | La queue de `ListingStatus` = projection compat, jamais source |
| **Événements canal** : dédup `(channel, eventKey)` (A1) ; monotonie de la vérité-canal, correctives forward-only ; tout drop journalisé | Rejeu, désordre, forge absorbés sans corruption | L'objet unique (double-vente) et l'intégrité de la FSM | Propriétés P-12/P-17 (fast-check) + journal `ChannelEvent` | `REPUBLISH` : seule arête arrière — commande explicite, `epoch++` |
| **Incidents bruyants** (INV-25) : entrer en `DIRTY`/`OVERSOLD` émet alerte + événement dashboard, atomiquement | Aucune publication zombie silencieuse | L'argent et la réputation vendeur (T2) | Propriété P-25 ; DoD observabilité | Aucune |

### Architecture Freeze — one-way doors actées (P1→P5)

> Toute modification d'un point ci-dessous est une **REVUE D'ARCHITECTURE** (mise à jour de
> l'artefact source + gate utilisateur), jamais un refactoring. Garde-fou : `/arch-gate`.

1. **Pricing canonique** `{ prixCents, offers?: { floorCents, autoAcceptCents? } }` — PAS d'union `fixed|auction` (P1).
2. **D1** : `floorCents` comparé au prix BRUT du canal ; les nets par canal = affichage estimatif.
3. **D2** : enchères hors v1 (si un jour : mode de publication channel-exclusif à FSM propre — jamais un pricing).
4. **D3** : bundles/lots hors v1.
5. **D4** : UN cerveau de négociation par canal — fonction pure de `capabilities.negotiation`, jamais deux.
6. **Règle de fermeture** (ADAPTER-CONTRACT §1) + **CC-1…7** (THREAT-MODEL §1).
7. **Port `ChannelConnector`** : `precheck/publish/update/retract/parseEvent` + `eventKey` obligatoire (A1).
8. **`CanonicalItem`/`CanonicalListing`** versionnés ; `categorie: CanonicalCategory` (C1 — ADR taxonomie requis).
9. **Capability matrix = SEUL vecteur** des différences inter-canaux (données, pas de code).
10. **FSM 10 états** (SYNC-FSM §1), croyance vs vérité, monotonie (INV-17) ; vue agrégée dérivée, jamais stockée.
11. **Tie-break double-vente = first-commit-wins** (encadré SYNC-FSM §4 — raisonnement conservé, ne pas rouvrir).
12. **Business Policy — hors Core** (D5 requalifiée au gate P3).
13. **Argent** : débit à USER_VALIDATED ; remboursement idempotent ≤1 par débit ; connecteurs sans wallet.
14. **Merchant-of-record** : porte explicitement NON franchie (seule voie ManoMano/Cdiscount — hors-scope).
15. **C1–C5 + A2 = pré-requis au commit du Lot 1** — aucun pivot DB sans eux ; checks STATIC câblés AVANT C1.

### Slash commands doctrine

`/closure-check` · `/pr-canal` · `/arch-gate` (cf. `.claude/commands/`) — elles **appliquent**
la doctrine, ne la modifient jamais. Tout problème d'architecture découvert en cours de route :
NE PAS le résoudre à chaud — l'ajouter à MASTER-REMED.md « Questions ouvertes », revue à froid.

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

## Méthode de travail

> Ces règles gouvernent COMMENT tu opères sur ce dépôt — elles priment sur toute habitude
> d'outil. Objectif permanent : moins de fichiers lus, moins d'outils, moins de contexte,
> de meilleures décisions. Réfléchir davantage avant d'agir, mais uniquement sur l'information
> réellement nécessaire.

### Outils & lecture du code
- Un outil est une capacité, jamais une obligation. Avant d'agir : réfléchir, cibler
  l'information strictement nécessaire, ne lancer que les outils indispensables. Jamais
  d'outil par habitude, jamais plusieurs outils « au cas où ».
- Avant de lire du code : identifier les fichiers exacts. Lire uniquement les fichiers
  concernés, leurs dépendances immédiates et les types indispensables. Pas d'exploration
  globale du dépôt sans raison, pas de recherche large quand quelques fichiers suffisent.
- Réduire en continu : fichiers lus, outils, commandes, modifications, taille de contexte.
  Privilégier la compréhension locale à l'exploration globale.

### Décision — avant d'implémenter
- Vérifier si une solution existe déjà, et si l'abstraction est réellement nécessaire.
- KISS, YAGNI, DRY, SSOT (cf. « Types partagés » ci-dessous). Ne jamais complexifier
  l'architecture sans bénéfice démontré. Toujours la solution la plus simple qui répond au besoin.
- La présence d'une bibliothèque dans le projet ne justifie jamais son usage. Une lib
  installée est une capacité future, pas une dépendance obligatoire.

### ROI avant dépendance — avant toute installation
Avant d'installer une bibliothèque, un SDK, un framework ou un service externe (LangGraph,
Vercel AI SDK, Langfuse, Promptfoo, BullMQ, Inngest, MCP, Playwright ou toute autre lib),
répondre systématiquement à :

1. Le besoin est-il réel aujourd'hui ?
2. Cette dépendance sera-t-elle utilisée dans le sprint en cours ou le suivant ?
3. Apporte-t-elle un gain significatif de temps, de qualité ou de simplicité ?
4. Son coût de maintenance est-il justifié ?
5. Peut-on résoudre le problème sans elle ?

Une réponse négative suffit à ne pas installer. « Utile un jour » n'est jamais un argument.
Principe : installer le plus tard possible, mais avant que son absence ne ralentisse
réellement le développement. Toujours privilégier simplicité, faible maintenance, faible
consommation de ressources, faible dette technique.

À chaque proposition d'installation, répondre sous cette forme :

```
Décision : INSTALLER / ATTENDRE
Justification :
- Valeur immédiate
- Coût de maintenance
- Alternatives
- Moment recommandé
```

Cette règle prime sur toute autre considération technique pour les propositions de dépendance.

### Boucle par tâche — ne sauter aucune étape
Analyse → Plan → **validation utilisateur** → Exécution → Tests ciblés → Typecheck →
Vérification → **commit atomique** (cf. règle Commits ci-dessous).

### Communication
- Réponses courtes, factuelles, sans remplissage ni répétition.
- Expliquer les décisions importantes ; signaler toute information manquante nécessaire à la
  décision avant de trancher.

---

## Gouvernance & standards

> **Definition of Done — observabilité.** Aucune fonctionnalité importante n'est considérée
> comme terminée tant qu'elle n'est pas observable depuis le dashboard admin, OU explicitement
> justifiée comme ne nécessitant pas d'observabilité. Le dashboard fait partie du produit : il
> évolue **en parallèle**, jamais après. À chaque fonctionnalité métier, répondre à 3 questions :
> (1) quelle donnée produit-elle ? (2) quel événement journaliser ? (3) mérite-t-elle d'apparaître
> au dashboard ? Non → ne rien afficher. Oui → instrumenter immédiatement. Toujours des données
> **réelles**, jamais de métrique artificielle.

> Détail complet : TECH_GOVERNANCE.md. Ici, uniquement les règles à appliquer par défaut.

- **Types partagés** : ne jamais recopier un payload d'API côté front. Le contrat vit dans
  `packages/core` (types purs, zéro dépendance runtime), importé par `api` **et** `web`/`mobile`.
- **Données UI** : une valeur affichée doit venir d'une mesure réelle. Interdit d'inventer une
  métrique, une latence ou un état de service — y compris pour un dashboard interne.
- **Composants web** : un composant = un fichier. `memo` sur les lignes de liste. Animations en
  `motion-safe:`. `aria-label` + `focus-visible` sur l'interactif. `tabular-nums` sur les chiffres.
- **Événements (observabilité)** : émettre aux points de transition réels (job IA, transitions
  `ListingStatus`, publish, refus admin), `type` dans une enum figée, `meta` sans PII ni donnée
  financière en clair.
- **Tests** : tout nouvel endpoint `/admin/*` a un test `app.inject` (au moins 200 + forme du payload).
- **Commits** : un commit par tâche atomique (`feat(scope): …`). Ne pas grouper plusieurs sujets.
- **Console admin (`apps/web`)** : reste locale/dev tant qu'il n'y a pas de vrai login — le token
  admin est inliné dans le bundle Vite, donc **non déployable publiquement** en l'état.
- **ADR** : toute décision qui fige un contrat (schéma, API, événement) ou choisit une techno
  structurante → un ADR dans `docs/adr/` (10 lignes max, cf. `ADR-000-template.md`).

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
- [x] **Décision inférence prod (2026-07-15, Maxime) : API hébergée** (reco CTO suivie,
      ROADMAP_2_6_MONTHS.md item 0). Ollama qwen2.5vl:3b reste le backend de DEV/TEST
      (PC local, `VisionService(OllamaVisionBackend)`) jusqu'à la fin du MVP. Le
      switch vers l'API hébergée (candidat : Claude Haiku 4.5, ~0,5 c€/annonce) se
      fait au moment de la mise en ligne stores (Play/Apple), pas avant — seam déjà
      en place (`packages/ai` : `backend` implémente une interface, seconde
      implémentation + sélecteur par config, zéro refonte). Ne pas implémenter le
      backend hébergé avant que le MVP soit fonctionnellement prêt (ROI — inutile de
      payer/maintenir une clé API tant que le produit change encore).
- [x] Pipeline IA asynchrone détaché (commit 6e42c95) : POST /ai/draft synchrone
      remplacé par POST /ai/draft/start (JWT, 202, { jobId }) + GET /ai/draft/:jobId
      (poll). Le serveur continue l'inférence même si le mobile est tué en arrière-
      plan (OEM agressifs type MIUI) — la requête HTTP synchrone ne bloque plus
      jamais au-delà de quelques secondes. Store en mémoire (Map, TTL 15 min,
      apps/api/src/routes/ai.ts) — pas de persistance DB, un redémarrage serveur
      perd les jobs en cours (acceptable, le mobile relance). Aucun listing/débit
      dans ce cycle : pure génération de texte, découplée de /listing/*.
      Côté mobile : useAnalysisQueue (apps/mobile/src/store/listing.store.ts),
      file persistée MMKV — un job « running » survit à un kill de l'app, poll
      toutes les 3-5 s tant que status === 'running'.
- [x] Différenciation réelle des formules par nombre de photos analysées
      (commit 4d080bb) : TIER_PHOTO_COUNT (SIMPLE=1, OPTIMIZED=2, PREMIUM=3) et
      TIER_FEATURES — SSOT packages/core/src/types/listing.ts. C'est le seul
      levier de différenciation produit actuel entre paliers (plus de photos =
      identification/prix plus fiables). Sans lien avec le seuil global d'upload
      1-6 (569842a, apps/api/src/routes/listing.ts MAX_PHOTOS_PER_LISTING) : ce
      seuil borne le nombre total de photos listées, TIER_PHOTO_COUNT borne
      combien d'entre elles sont envoyées à /ai/draft/start pour l'analyse.
      Sélection du palier à l'écran de capture (vendre.tsx) — non modifiable
      après coup sans relancer l'analyse ; verrouillé à l'écran de validation
      (validate.tsx).

---

## Claude Code Environment — Optimisé 2026-07-14

### Plugins Anthropic (6)

| Plugin | Rôle | Activé |
|---|---|---|
| security-guidance | Hooks pattern-matching + revue LLM diffs + revue commit agentique (injection, XSS, SSRF, secrets, 25+ classes). Critique pour wallet/JWT/Stripe | ✅ |
| pr-review-toolkit | 6 agents : code-reviewer, simplifier, comment-analyzer, test-analyzer, silent-failure-hunter, type-design-analyzer | ✅ |
| commit-commands | `/commit`, `/commit-push-pr`, `/clean_gone` pour git workflow | ✅ |
| typescript-lsp | Diagnostics TS, navigation, typage cross-package monorepo | ✅ |
| claude-md-management | `/revise-claude-md` pour capturer apprentissages session | ✅ |
| hookify | Générateur de hooks customs (ex : interdire Float monnaie, forbid `any`) | ✅ |

### Marketplace Communautaire (1)

| Marketplace | Plugin | Rôle |
|---|---|---|
| upstash/context7 | context7 v1.0.2 | Docs Expo/Prisma/Fastify/React Native fraîches + injectées dans contexte |

### MCP Servers (1)

| Server | Transport | Rôle |
|---|---|---|
| Expo (officiel) | HTTP https://mcp.expo.dev/mcp | EAS builds, TestFlight crash data, docs SDK, simulator control |

### Agents Personnalisés (2)

- Fullstack Developer (AITmpl)
- Backend Architect (AITmpl)

### Skills Personnalisées (4)

- Senior Backend (refs API design, DB optim, security ; scripts Python load-test / scaffolder)
- Mobile Design (11 fichiers : anti-memorization, touch-psychology, platform iOS/Android, perf RN/Flutter, testing, debugging)
- ui-ux-pro-max (161 palettes, 57 font pairings, 161 product types, 99 UX guidelines, 25 charts ; consultable via script)
- Frontend Design (studio direction, anti-template thinking)

### Connecteurs Anthropic (5)

- Engineering (GitHub)
- Design (Figma, Intercom)
- Productivity (Linear)
- Data (unused)
- Prisma (DB schema)

### Résumé État

**7 plugins · 6 skills · 19 agents · 13 hooks · 1 MCP server · 1 LSP server**

**Posture** : Léger, sans doublon, aligné stack (RN/Expo/Fastify/TS/Prisma/PostgreSQL/Supabase/GitHub).
**Sécurité** : Revue de code systématique + détection vuln crypto/JWT/secrets.
**Documentation** : Contexte injecté auto (Expo SDK, Prisma 5, Fastify 4 docs fraîches via Context7).
**Mobile** : Anti-defaults checklist avant chaque screen (mobile-design-thinking.md obligatoire).
