# FlipSync — Gouvernance technique

> **Nature.** Ce document n'ajoute pas de fonctionnalités. Il fixe les **règles qui empêchent le
> projet de dériver** sur 6 mois. Rédigé en CTO. Il complète le triptyque :
> - [OBSERVABILITY_PLAN.md](OBSERVABILITY_PLAN.md) → **quoi** construire maintenant.
> - [ROADMAP_2_6_MONTHS.md](ROADMAP_2_6_MONTHS.md) → **vers où** évoluer.
> - **TECH_GOVERNANCE.md** (ce fichier) → **ce qui ne doit pas bouger**, et pourquoi.
>
> Principe : on gèle les **contrats** (cher à rétrofit), on garde libres les **implémentations**
> (isolables derrière une interface). La robustesse ici, c'est la sobriété — pas la sophistication.

---

## État réel de l'outillage (constaté, pas supposé)

| Élément | État | Note |
|---|---|---|
| CI (`.github/workflows/ci.yml`) | ✅ Bon | `build + test + typecheck` tous workspaces (mobile inclus), Postgres réel, sur push `main` + toutes PR |
| Typecheck | ✅ | `strict` partout, `tsc -b`, mobile via `--noEmit` |
| Tests | ✅ Partiel | `*.db.test.ts` (api, Postgres réel) + `listing.test.ts` (core). Pas de test sur le contrat `/admin`. |
| Prettier | ⚠️ Incohérent | `.prettierrc` racine (no-semi, single-quote) **non respecté par `apps/web`** (semi, double-quote). Aucun `prettier --check` en CI. |
| ESLint | ❌ Absent | Aucune config projet. `apps/web` lint = `echo "no lint configured"`. |
| Enums | ✅ SSOT | Générés depuis `schema.prisma` (`packages/core/scripts/generate-enums.mjs`), sortie gitignorée + régénérée au build → **pas de risque d'enum périmé commité**. |
| Secrets | ✅ | `.env` gitignoré, seul `.env.example` versionné. |
| Index DB | ⚠️ Manquants | Colonnes interrogées par le dashboard non indexées (cf. §9). |
| `packages/core` | ✅ | **Zéro dépendance runtime** (types purs). À préserver. |

---

## 1. Architecture — ce qui doit être figé maintenant

Geler ces éléments coûte peu aujourd'hui et évite une refonte dans 3 mois.

| Zone | Règle figée | Pourquoi |
|---|---|---|
| **Direction des dépendances** | `apps/*` dépendent de `packages/*`, jamais l'inverse. `packages/core` reste **sans dépendance runtime**. `core` ne dépend ni de `db`, ni de `ai`. | Empêche les cycles et garde `core` importable partout (mobile inclus). |
| **SSOT enums** | `schema.prisma` est la source. Les enums TS sont **générés**, jamais recopiés à la main. | Duplication = dérive silencieuse. Déjà en place, à ne pas contourner. |
| **Types de payload API** | Les contrats `/admin/*` (et tout endpoint consommé par le web) vivent dans `packages/core`, importés par api **et** web. **Interdit de re-taper les types côté front.** | `apps/web/src/services/api.ts` les recopie aujourd'hui → dérive front/back garantie à terme. |
| **Schéma d'événement** | `{ ts, source, type, level, message, meta }` avec `type` en **enum**. Figé avant d'accumuler des données. | Colonne vertébrale de l'observabilité (historique, analytics, alerting). Migrer des events déjà stockés = douloureux. |
| **Erreurs API** | `{ error: 'SNAKE_CASE_CODE' }`. HTTP 4xx/5xx cohérents. | Déjà la convention ; la figer explicitement. |
| **Finance** | Toujours centimes (`Int`). Jamais de float. `centsToEur`/`eurToCents`. | Déjà non négociable ; rappelé ici comme invariant de gouvernance. |
| **Store front** | Une ressource = une action de fetch + un sélecteur. Polling piloté par le store (`startPolling`/`stopPolling`), jamais de `useEffect` de fetch dans les composants. | Pattern déjà établi (Mission Control) ; le figer évite le retour des effets sauvages. |
| **Nomenclature** | Noms de sous-systèmes (ATLAS/VEGA/ORION/LYRA/NOVA/RHEA) = identités UI stables. `ListingStatus` = machine à états canonique. | Renommer casse le store, les events et les filtres. |

**Organisation des dossiers : figée telle quelle.** `apps/{mobile,api,web}` + `packages/{core,db,ai,wallet,marketplace}`. Ne pas introduire de nouveau top-level sans ADR.

---

## 2. Dette technique — à corriger avant que ça coûte

### 🔴 Critique (traiter tôt, effet de cliquet)
- **Dérive de types front/back** : `api.ts` recopie les payloads `/admin`. Au moment où l'on va
  **multiplier** les endpoints admin (health, metrics, events), le risque explose. → §1 + Action A2.
- **Événements non instrumentés** : tout ce qui n'est pas journalisé aujourd'hui est **perdu à
  jamais** (pas de backfill). → OBSERVABILITY_PLAN T4, à faire tôt.
- **`VITE_ADMIN_TOKEN` inliné dans le bundle web** : Vite inline les `VITE_*` au build. Le JWT
  admin se retrouve **dans le JavaScript livré**. Acceptable en local, **interdit en déploiement
  public** en l'état. → §8, règle à graver.

### 🟠 Importante (ne pas laisser pourrir)
- **Prettier non respecté par le web** : le web diverge du standard repo. Tant qu'il est petit,
  le conformer est cheap ; plus il grossit, plus le diff devient risqué. → décision B (formatage).
- **Pas de `prettier --check` ni de lint en CI** : rien n'empêche la dérive de style de repasser.
- **Pas de test de contrat `/admin`** : la console web dépend de ce contrat sans filet.
- **Index DB manquants** sur les colonnes du dashboard (§9) : invisible aujourd'hui, lent demain.

### 🟢 Acceptable (dette assumée, documentée)
- **Connecteurs marketplace = squelettes** : volontaire, en attente d'accès partenaire. Pas une dette.
- **`llama.rn` encore dans `apps/mobile`** : à retirer au prochain build EAS (APK plus léger). Noté.
- **Métriques in-process remises à zéro au redémarrage** : acceptable ; labelliser « fenêtre glissante ».
- **Événements en mémoire** avant persistance (T14) : acceptable transitoirement.
- **Fichiers racine parasites** (`app.json`, `.expo/`, `.cockpit.json` à la racine) : hygiène, pas urgent.

---

## 3. Standards à ajouter à `CLAUDE.md`

Seulement le **net-nouveau** (ce qui n'y est pas déjà). Ne pas ré-écrire les règles existantes
(centimes, `strict`/no-`any`, JWT, erreurs snake_case, redaction des logs, IA côté serveur…).

| Domaine | Règle à ajouter | Justification |
|---|---|---|
| **Types partagés** | Ne jamais recopier un payload d'API côté front. Contrat → `packages/core`, importé des deux côtés. | Tue la dérive (dette 🔴). |
| **Données UI** | Une valeur affichée doit venir d'une mesure réelle. Interdit d'inventer une métrique, une latence ou un état de service. | Principe déjà appliqué ; le graver empêche le NOC-cosplay. |
| **Composants web** | Un composant = un fichier, `memo` sur les lignes de liste, animations en `motion-safe:`, `aria-label` + `focus-visible` sur l'interactif, `tabular-nums` sur les chiffres. | Cohérence + a11y + perf, déjà la pratique. |
| **Événements** | Émettre un event aux points de transition réels (job IA, transitions `ListingStatus`, publish, refus admin). `type` dans l'enum figée. `meta` **sans PII ni données financières en clair**. | Observabilité + conformité. |
| **Tests** | Tout nouvel endpoint `/admin/*` a un test `app.inject` (au moins 200 + forme du payload). | La console dépend de ces contrats. |
| **Commits** | Un commit par tâche atomique (`feat(scope): Tn — …`). Ne pas grouper. | Réversibilité, revue, bissection. |
| **Console web** | La console admin est **locale/dev** tant qu'il n'y a pas de vrai login. Ne pas la déployer publiquement avec un token inliné. | Sécurité (dette 🔴). |
| **`packages/core`** | Reste sans dépendance runtime (types + constantes purs). | Importable partout, mobile inclus. |

*(Action A4 les ajoute.)*

---

## 4. Architecture Decision Records (ADR) — système léger

**Adopté.** Format volontairement minimal — 10 lignes max par ADR. Objectif : ne pas **oublier
pourquoi**, pas produire de la doc.

Structure : `docs/adr/` avec un `ADR-000-template.md` et un `README.md` (index).

Template :
```
# ADR-00X — <Titre>
- **Statut :** Accepté | Proposé | Remplacé par ADR-00Y | Ouvert
- **Date :** AAAA-MM-JJ
- **Contexte :** 1–3 phrases. Le problème.
- **Décision :** 1–3 phrases. Ce qu'on fait.
- **Conséquences :** 1–3 phrases. Ce que ça coûte / verrouille.
```

**Seed initial** (décisions déjà prises, à formaliser — Action A3) :
- ADR-001 — Valeurs monétaires en centimes entiers (jamais float).
- ADR-002 — Monolithe modulaire sur Turborepo (pas de microservices).
- ADR-003 — Inférence IA côté serveur ; on-device abandonné (pivot Sprint 4).
- ADR-004 — Publication via APIs partenaires officielles uniquement (pivot Sprint 3).
- ADR-005 — Jobs IA asynchrones persistés en Postgres (`DraftJob`), pas en mémoire.
- ADR-006 — Autorisation admin par `ADMIN_EMAILS` (CSV), sans rôle en base.
- ADR-007 — `schema.prisma` = SSOT ; enums TS générés.
- ADR-008 — **Ouvert** : fournisseur d'inférence prod (cf. ROADMAP Item 0).

Règle : toute décision qui **fige un contrat** ou **choisit une techno structurante** = un ADR.
Le reste n'en a pas besoin.

---

## 5. Documentation vivante — ce que je **refuse** de générer

Tu proposes de générer architecture/flux/endpoints/events/stores/dépendances. **En CTO, je
recommande de ne PAS construire de pipeline de doc auto.** Un générateur de doc devient vite une
**doc périmée** = un mensonge maintenu. La bonne réponse : pointer les **SSOT qui existent déjà**.

| Ce qui doit rester à jour | SSOT réel (déjà là) | Faut-il générer ? |
|---|---|---|
| Schéma DB | `schema.prisma` | Non — c'est la source. |
| Enums | `packages/core/src/generated/` | Non — déjà généré au build. |
| Contrats API | Types partagés `packages/core` (Action A2) | Non — le type **est** la doc. |
| Catalogue d'événements | L'enum `type` d'event (§1) | Non — l'enum **est** le catalogue. |
| Graphe de dépendances | `turbo run build --graph` (natif) | Non — commande à la demande. |
| Liste des routes | `app.printRoutes()` (Fastify, natif) | Optionnel — script dev à la demande, pas en artefact versionné. |

**À ne pas faire : OpenAPI/Swagger.** Pour une API interne mono-consommateur (la console),
`@fastify/swagger` = une dépendance + une maintenance pour une valeur quasi nulle. Les **types
partagés** couvrent le besoin.

Seul artefact « vivant » à tenir à la main : **CLAUDE.md** (index de contexte) + les **ADR**
(pourquoi). Courts, humains, non générés.

---

## 6. Qualité — garde-fous à ajouter (seulement ceux qui apportent)

Ce qui **existe déjà** : build, test, typecheck (tous workspaces + mobile), sur push + PR, avec
Postgres réel, `prisma migrate deploy` avant tests. **C'est déjà un bon socle pour un solo.**

Trous à combler, par valeur :

| Garde-fou | Valeur | Verdict |
|---|---|---|
| `prettier --check` en CI | Élevée | ✅ Oui — **après** avoir conformé le web (décision B). Sinon la CI casse immédiatement. |
| Test de contrat `/admin/*` (`app.inject`) | Élevée | ✅ Oui — protège la console. À exiger sur chaque nouvel endpoint (§3). |
| ESLint | Moyenne | 🟡 B — utile mais config + bruit à cadrer ; décision de standards. |
| Vérification enum-sync en CI | Nulle | ❌ Non — déjà couvert : les enums sont régénérés au build, jamais commités périmés. |
| `prisma validate` en CI | Faible | 🟡 Optionnel — `migrate deploy` échoue déjà si le schéma est cassé. |

**Ne pas** ajouter de gate qui double un contrôle existant. La CI actuelle attrape déjà : types
cassés, tests rouges, build KO, migration invalide.

---

## 7. Observabilité — métriques réelles non encore identifiées

En complément de l'OBSERVABILITY_PLAN, **uniquement des signaux dérivables de données réelles** :

| Métrique | Source réelle | Pourquoi elle compte |
|---|---|---|
| **Jobs IA bloqués** | `DraftJob` en `RUNNING` plus vieux que le timeout (120 s) | Détecte une inférence figée ou un redémarrage en plein job. Signal de fiabilité. |
| **Distribution de latence d'inférence** (p50/p95) | `DraftJob` READY : `updatedAt − createdAt` | **Nourrit directement la décision Item 0** (coût/perf du provider). |
| **Taux de succès IA** | READY / (READY + FAILED) | Qualité réelle du backend d'inférence. |
| **Ratio de remboursement** | `WalletTransaction` REFUND / DEBIT (24h) | Santé financière : un pipeline qui échoue « saigne » de l'argent. |
| **Consommation du free tier** | Listings en FREE_CREDIT | Signal produit (coût d'acquisition réel). |
| **Échecs d'auth / magic-link** | Events `warning` source LYRA | Signal d'abus. |

Toutes calculables sans instrumentation lourde. Les **jobs bloqués** et la **latence d'inférence**
sont les deux à plus forte valeur (fiabilité + décision prod).

---

## 8. Sécurité — protections simples et réellement utiles

Ce qui est **déjà bon** : `.env` gitignoré, garde admin fail-closed (`ADMIN_EMAILS`), Zod partout,
`bodyLimit` sur `/ai`, rate limiting sur l'auth (`auth.ratelimit.test.ts`), redaction du header
`authorization` dans les logs, signature Stripe webhook (à ne jamais skipper).

À ajouter / graver :

| Protection | Verdict | Détail |
|---|---|---|
| **Console web non déployable publiquement** | 🔴 Graver | `VITE_ADMIN_TOKEN` est inliné dans le bundle. Règle : local/dev only jusqu'à un vrai login (§3). |
| **Rate limit sur `/ai/draft/start`** | 🟡 B | Endpoint coûteux (inférence). Un abus fait grimper le coût/charge. Valider un seuil. |
| **`meta` d'événement sans PII/finance en clair** | ✅ Graver | Étend la discipline de redaction aux nouveaux events (§3). |
| **Rate limit léger sur `/admin/*`** | 🟡 Optionnel | Faible priorité (déjà derrière JWT + allow-list). |

**Ne pas** ajouter : secrets manager (Vault), rotation automatique, WAF. Sur-dimensionné pour
l'échelle actuelle ; env + discipline suffisent.

---

## 9. Performance — gains évidents uniquement

Un seul gain vraiment évident et concret : **les index Prisma manquants** sur les colonnes que le
dashboard interroge **en boucle** (polling 15 s × 5 requêtes). Invisible aujourd'hui (peu de
données), coûteux quand les tables grossissent — et le polling **amplifie** le coût.

| Requête admin (réelle) | Colonnes filtrées | Index manquant |
|---|---|---|
| `listing.groupBy(status)` + counts `status/updatedAt` | `Listing.status`, `updatedAt` | `@@index([status, updatedAt])` |
| `draftJob.count(status, updatedAt)` (metrics à venir) | `DraftJob.status`, `updatedAt` | `@@index([status, updatedAt])` |
| `walletTransaction.groupBy(type)` `createdAt≥24h` | `WalletTransaction.type`, `createdAt` | `@@index([type, createdAt])` |

→ Action A1. Réversible (migration de drop), fort effet à l'échelle.

Le reste (`memo`, virtualisation des logs) est **déjà prévu** dans l'OBSERVABILITY_PLAN. **Ne pas**
optimiser au-delà : pas de cache HTTP, pas d'endpoint combiné, pas de dénormalisation — prématuré.

---

## 10. Maintenabilité à 2× — les décisions qui tiennent

Si FlipSync double dans 6 mois, ce qui garde le projet simple :

1. **Types partagés** (A2) → front et back ne divergent jamais. La classe de bug la plus insidieuse
   à cette échelle disparaît.
2. **Schéma d'événement figé** (§1) → analytics/alerting/replay se branchent sans migration.
3. **ADR** (§4) → on n'argumente pas deux fois la même décision ; l'onboarding (même solo, 6 mois
   plus tard) est instantané.
4. **CI qui reste verte = définition de « ça marche »** → refuser toute fonctionnalité qui casse un
   gate plutôt que désactiver le gate.
5. **Monolithe modulaire préservé** → une personne peut tout tenir en tête. Chaque brique d'infra
   ajoutée (Redis, worker, TSDB) est une chose de plus à maintenir seul : on refuse par défaut.
6. **Interfaces stables, implémentations libres** → `VisionBackend` et `CredentialsResolver`
   absorbent les gros changements (provider IA, multi-vendeurs) sans onde de choc.

---

# ACTIONS SONNET

## A. À faire immédiatement — faible risque, forte valeur, aucune décision métier

Sonnet peut les exécuter **une par une, dans l'ordre, sans attendre**. Détail atomique en annexe.

- **A1 — Index Prisma** sur les colonnes interrogées par le dashboard. *(perf/scaling, réversible)*
- **A2 — Types `/admin` partagés** dans `packages/core`, importés par api + web. *(tue la dérive)*
- **A3 — Échafaudage ADR** `docs/adr/` + template + seed ADR-001…008. *(pure doc)*
- **A4 — Section gouvernance dans `CLAUDE.md`** (§3). *(pure doc)*
- **A5 — Hygiène `.gitignore`** des artefacts racine parasites. *(après investigation)*

## B. À faire uniquement après ta validation — impact ou décision

- **B1 — Conformer `apps/web` au `.prettierrc`** racine (reformatage global, diff volumineux mais
  mécanique). *Recommandé maintenant, tant que le web est petit.* Puis **B2**.
- **B2 — Ajouter `prettier --check` en CI** (dépend de B1, sinon la CI casse).
- **B3 — Décision Item 0 : fournisseur d'inférence prod** (API hébergée recommandée). Débloque
  coûts, workers, multi-moteurs. → ADR-008.
- **B4 — Figer le schéma `AdminEvent` + l'enum `type`** avant de persister des événements (T14).
- **B5 — ESLint** (config + périmètre de règles à cadrer).
- **B6 — Rate limit sur `/ai/draft/start`** (choisir le seuil).
- **B7 — Table `MarketplaceAccount`** (multi-vendeurs) — **décision produit** préalable.
- **B8 — Retrait de `llama.rn`** d'`apps/mobile` (au prochain build EAS).

## C. À ne pas faire — prématuré / sur-ingénierie

| Refusé | Pourquoi (technique) |
|---|---|
| Redis / BullMQ / file externe | `DraftJob` (Postgres) suffit ; en API hébergée l'inférence est déjà déportée. Dépendance d'infra sans demande. |
| Workers / process séparés | Non justifié hors GPU auto-hébergé **saturé**. Voir ROADMAP Item 0. |
| Microservices | Le monolithe modulaire est correct pour un solo. Le réseau ajoute pannes partielles + ops. |
| Base time-series (Prometheus/Grafana) | Postgres + agrégats couvrent l'échelle. Un TSDB = un système de plus à tenir. |
| Multi-moteurs IA simultané | Aucun multi-provider utilisé. Garder un backend *remplaçable* + fallback optionnel. |
| Auto-doc (OpenAPI/Swagger) | Doc générée = doc périmée. Les types partagés + le schéma sont la source. |
| Gate enum-sync en CI | Déjà couvert : enums régénérés au build, jamais commités périmés. |
| Auto-healing / contrôles de cycle de vie agent | Les « agents » ne sont pas des process. Rien à piloter. |
| Mode Replay | N'a de sens qu'après persistance des events (T14) + volume d'incidents réel. |
| Secrets manager / rotation auto / WAF | Sur-dimensionné. Env + discipline suffisent à cette échelle. |

---

## Annexe A — Tâches A prêtes à exécuter (atomiques, indépendantes, testables, réversibles)

> Pour Sonnet : exécute A1→A5 dans l'ordre. Une tâche = un commit. Chaque tâche est réversible.
> Ne touche **rien** des catégories B/C.

### A1 — Index Prisma sur les colonnes du dashboard
- **Fichiers :** `packages/db/prisma/schema.prisma` + nouvelle migration.
- **Faire :** ajouter `@@index([status, updatedAt])` sur `Listing` et sur `DraftJob` ;
  `@@index([type, createdAt])` sur `WalletTransaction`. Générer une migration nommée
  `add_admin_query_indexes` (`npm run db:migrate`).
- **Test :** `npx prisma validate` OK ; la migration s'applique sur une base propre ;
  `turbo run typecheck test` vert (les `*.db.test.ts` passent toujours).
- **Réversible :** migration inverse (drop index). Aucun impact fonctionnel.

### A2 — Types `/admin` partagés dans `packages/core`
- **Fichiers :** `packages/core/src/types/admin.ts` (nouveau) + export dans `packages/core/src/index.ts` ;
  `apps/api/src/routes/admin.ts` (annoter le retour avec le type partagé) ;
  `apps/web/src/services/api.ts` (importer depuis `@flipsync/core`, supprimer les interfaces recopiées) ;
  `apps/web/package.json` (ajouter `@flipsync/core` en dépendance workspace).
- **Faire :** définir `AdminOverview`, `ConnectorState` (et les futurs `SystemHealth`/`SystemMetrics`/
  `SystemEvent` quand ils arriveront) comme **types purs** dans core. `import type` côté web
  (aucun impact runtime). `core` reste sans dépendance.
- **Test :** `turbo run typecheck` vert (api + web) ; `apps/web` build (`tsc -b && vite build`) OK ;
  preview inchangée (changement type-only).
- **Réversible :** revert des imports.
- **Note :** aligne le web sur le pattern déjà utilisé par l'api (qui consomme déjà `@flipsync/core`).

### A3 — Échafaudage ADR + seed
- **Fichiers :** `docs/adr/README.md` (index + règle d'usage), `docs/adr/ADR-000-template.md`,
  `docs/adr/ADR-001…ADR-008-*.md` (contenu §4, 10 lignes max chacun, ADR-008 = statut Ouvert).
- **Faire :** reprendre le template et le seed de la §4. Liens relatifs valides.
- **Test :** les fichiers existent ; aucun impact code ; `turbo run build` inchangé.
- **Réversible :** supprimer `docs/adr/`.

### A4 — Section gouvernance dans `CLAUDE.md`
- **Fichiers :** `CLAUDE.md` (ajouter `## Gouvernance & standards` avec le tableau §3, **net-nouveau
  uniquement** — ne pas dupliquer les règles existantes).
- **Test :** doc seulement ; relecture cohérente avec l'existant.
- **Réversible :** revert.

### A5 — Hygiène `.gitignore` (avec investigation préalable)
- **Fichiers :** `.gitignore`.
- **Faire :** vérifier d'abord la nature des fichiers racine non suivis (`app.json`, `.expo/`,
  `.cockpit.json`, `tsconfig.json`). Si ce sont des artefacts égarés (expo lancé à la racine au
  lieu de `apps/mobile`), les ignorer (`/.expo/`, `/.cockpit.json`, `/app.json`). **Ne pas ignorer
  `tsconfig.json` racine sans confirmer** qu'il n'est pas un vrai config référencé.
- **Test :** `git status` propre des parasites ; `turbo run build typecheck` inchangé.
- **Réversible :** retirer les lignes ajoutées.
- **Garde-fou :** examiner chaque fichier avant de l'ignorer — ne rien masquer de significatif.
