# THREAT-MODEL — Multi-canal : fermeture, abus, invariants (P3, 2026-07-13)

> **Objet** : le système POST-pivot — ADAPTER-CONTRACT appliqué, corrections C1–C5 faites.
> Ce document contraint une implémentation à venir ; ce n'est PAS un ré-audit du code actuel
> (→ FLIPSYNC-AUDIT). Chaque menace se termine par un invariant falsifiable, consommé par
> P4 (FSM de sync), P5 (propriétés testables) ou P6 (doctrine CLAUDE.md).
> §1 répond au mandat explicite du gate : formaliser les invariants de fermeture issus de P2.

---

## 1. Core Closure Invariants (CC-1 … CC-7)

Règle mère (ADAPTER-CONTRACT §1) : *un champ n'entre dans le core que s'il décrit l'objet
physique ou le mandat du vendeur, indépendamment de tout canal*. Les CC la déclinent en règles
**falsifiables** — chacune a un test mécanique de violation (grep/CI en P5, revue en P6).
« Core » = `packages/core`, `packages/wallet`, `packages/ai`, `packages/db` (modèles hors
`ChannelPublication.channel`), `apps/api`, `apps/mobile`. Le registre des connecteurs
(composition root, exception unique de CC-3) vit dans `packages/marketplace/src/registry.ts` —
donc hors Core par construction, jamais dans `apps/api` (correction ERRATA E-4 : l'ancienne
exclusion « apps/api hors enregistrement des connecteurs » contredisait CC-3/`/pr-canal`).

| id | Invariant (falsifiable) | Test de falsification | Statut 2026-07-13 |
|---|---|---|---|
| **CC-1** | Hors la **déclaration de nomenclature** (l'enum de canaux dans `schema.prisma` + enums générés — valeurs = identifiants opaques), aucun symbole du Core ne référence un canal nommément | grep insensible `lbc\|leboncoin\|vinted\|ebay\|shopify\|rakuten\|amazon\|manomano\|cdiscount\|etsy` sur le périmètre Core (patterns exacts → P5) | **Violé** : `categorieLbc/categorieVinted` ([listing.ts:79-80](packages/core/src/types/listing.ts:79)), colonnes `publishedLbc/publishedVinted/lbcUrl/vintedUrl`. Rétabli par C1 + Lot 1 |
| **CC-2** | Aucune entité du domaine (modèle Prisma, type core) ne possède un champ **spécifique à un canal**. Seules références légitimes dans les données : un champ discriminant typé par l'enum de canaux (`ChannelPublication.channel`) et `externalId`/`externalMeta` possédés par l'adapter | Revue de schéma : tout champ dont le nom ou la sémantique n'existe que pour UN canal = violation. Grep noms de canaux sur les identifiants de champs | **Violé** (mêmes ancrages que CC-1). Rétabli par C1 (types), Lot 1 (colonnes legacy → drop avec les adapters Vinted/LBC) |
| **CC-3** | Aucun **branchement métier** ne dépend d'un nom de canal : pas de `if/switch` sur une valeur de l'enum hors `packages/marketplace`. UNE seule énumération autorisée dans tout le dépôt = le **registre des connecteurs** (composition root) | grep `SalesChannel\.\|Marketplace\.` hors marketplace : positions de type uniquement, jamais de comparaison. CI-able | Violé par la double-colonne legacy (publication écrit `publishedLbc`/`publishedVinted` par canal). Rétabli par le Lot 1 (lignes `ChannelPublication` génériques) |
| **CC-4** | Toute différence de comportement inter-canaux transite **exclusivement** par le port `ChannelConnector` + la capability matrix : elle se réduit à (a) une valeur de matrix, (b) du code dans UN connecteur. Une PR « différence de canal » qui touche core/wallet/routes/mobile = violation | Règle de revue (P6) + diff-check : le périmètre de fichiers d'une PR canal est `packages/marketplace/**` + config | Non testable avant le pivot — le Lot 1 sera le premier test |
| **CC-5** | Un nouveau canal s'ajoute **sans modification du Core Domain** : exactement les 5 étapes d'ADAPTER-CONTRACT §12 (enum += 1 valeur — migration additive sans logique —, connecteur, ligne de matrix, mapping catégories, credentials). Une 6ᵉ étape nécessaire = fermeture rompue → retour architecture | Le **diff réel** de chaque canal ajouté est la preuve ou la réfutation. Premier test grandeur nature : adapters Vinted/LBC | Non testable avant le premier adapter réel |
| **CC-6** | Le core ne connaît que `CanonicalCategory` : les référentiels de catégories par canal (tables de mapping, résolution) vivent dans chaque connecteur ; le **prompt IA** produit LA catégorie canonique et ne mentionne jamais un canal | grep noms de canaux sur `packages/ai` (prompts inclus) ; fichiers de mapping uniquement sous `connectors/` | **Violé** : le prompt produit `categorieLbc` + `categorieVinted`. Rétabli par C1 |
| **CC-7** | L'UI (mobile/web) ne contient aucun branchement métier sur un canal : la liste des canaux, l'éligibilité (sortie `precheck`) et les états viennent de l'API. Toléré : mapping présentationnel id → logo/couleur, tant que la LISTE affichée vient de l'API | grep noms de canaux sur `apps/mobile/src`, `apps/web/src` hors assets de marque ; aucun `if` métier sur un nom de canal | Violé (écran validation affiche les 2 catégories par canal). Rétabli par C1 (une seule catégorie canonique affichée) |

CC-1/2/3 sont outillables en CI dès le pivot (P5). CC-4/5 sont des règles de revue + un test
falsifiable par diff (P6). Que 5 des 7 soient violés aujourd'hui est exactement la raison d'être
de C1–C5 **avant** le commit du Lot 1 ; leur valeur ensuite = empêcher la ré-érosion (→ T16).

---

## 2. Actifs & acteurs

| Actif | Pourquoi c'est un actif |
|---|---|
| A1 — Wallet user | Argent réel (centimes). Toute faille = perte directe ou double-facturation |
| A2 — L'objet unique | 1 exemplaire physique. La double-vente est une faute marchande (2 acheteurs ont payé), pas un bug d'affichage |
| A3 — Comptes & réputation vendeur sur les canaux | Un incident (annonce zombie, vente annulée) dégrade le compte DU USER, pas celui de FlipSync |
| A4 — Credentials partenaires FlipSync (clé agrégateur/API partagée) | Rayon d'explosion = **toute la plateforme** : une révocation partenaire coupe le canal pour tous les users |
| A5 — Tokens OAuth vendeurs stockés serveur | Honeypot : permet d'agir sur les comptes marchands des users |
| A6 — La promesse « jamais sous ton prix mini » | La casser une fois détruit la proposition de valeur du Commissaire-Priseur |
| A7 — La fermeture elle-même (§1) | L'érosion architecturale est une menace au même titre qu'un exploit — elle recrée L1 |

Acteurs : acheteur opportuniste cross-canal · user abusif (churn, quotas) · canal défaillant ou
menteur (API en panne, statuts faux, contenus hostiles) · agrégateur qui dérive (transport ≠ vérité) ·
attaquant réseau (rejeu, forge de webhook) · courses internes (2 événements simultanés) ·
**le dev pressé** (érosion par commodité — l'acteur le plus probable de ce document).

---

## 3. Abus & menaces (T1 … T16)

### Bloc A — L'objet unique (A2, A3)

| id | Scénario d'abus | Invariant tueur |
|---|---|---|
| **T1** | **Course à la double-vente** : SOLD sur Vinted à T ; l'annonce LBC reste vivante jusqu'à T+SLA ; un acheteur LBC paie dans la fenêtre. Variante race : deux SOLD arrivent de deux canaux à quelques secondes d'écart | **INV-1** : `SOLD(c)` déclenche immédiatement `retract(∀c′≠c)` ; la fenêtre d'exposition est bornée par `max(retractSla) + budget de retries` des canaux publiés (borne réelle, alignée P-21 — correction ERRATA E-17) — c'est une donnée de matrix/config, donc un choix de canaux = un risque connu. **INV-2** : au plus UNE vente honorée par objet ; toute seconde vente concurrente est annulée canal-side, jamais honorée (tie-break déterministe : ordre de commit DB, first-commit-wins — mécanisme → P4 §4) |
| **T2** | **Publication zombie** : `retract()` échoue en boucle (TRANSIENT, canal down) alors que l'objet est parti ailleurs ; l'annonce vivante encaisse un acheteur | **INV-3** : retries de retract bornés puis état **DIRTY** : alerte admin + gel des nouvelles publications sur ce canal pour ce user + événement dashboard. Une publication irrétractable est un **incident de niveau argent**, pas une ligne de log (DoD observabilité). État DIRTY → P4 |
| **T3** | **Transport menteur** (agrégateur ou canal) : publish ACKé mais annonce jamais live (`SUBMITTED` éternel) ; `RETRACT_CONFIRMED` reçu mais annonce encore vivante ⚠ | **INV-4** : `SUBMITTED` est borné par un timeout par canal (donnée de matrix) → au-delà, `FAILED TRANSIENT` puis chemin standard. **INV-5** : la **vérité = le canal**, jamais le transport ; quand le canal expose une lecture directe ⚠, la réconciliation (P4) poll le canal, l'agrégateur n'est qu'un tuyau |

### Bloc B — L'argent (A1)

| id | Scénario d'abus | Invariant tueur |
|---|---|---|
| **T4** | **Remboursement rejoué** : PUBLISH_FAILED → refund auto → retry → 2ᵉ échec → 2ᵉ refund (pattern audit H3, ressuscité par le multi-canal où les échecs par canal se multiplient) | **INV-6** : au plus UN remboursement par débit — idempotence par clé `(listingId, débit)`, dans la même `$transaction` que la transition d'état |
| **T5** | **Échec partiel N canaux** : 2 canaux PUBLISHED, 1 FAILED PERMANENT. Le contrat (§5.4) dit « remboursement via flux existant » — écrit pour un monde mono-canal, **ambigu** à N canaux : rembourse-t-on ? | **INV-7 (requalifié au gate P3)** : l'architecture expose uniquement le **fait observable** (états par canal + agrégat SYNC-FSM §7 : `PARTIAL_SUCCESS`, `TOTAL_FAILURE`…). La règle de remboursement est une **Business Policy — hors Core** (couche Billing/Product), jamais encodée dans le contrat, la FSM ou les connecteurs. Obligation architecturale résiduelle : le fait est fiable, atomique, observable |
| **T6** | **TOCTOU precheck→débit** : éligible à T0, débité à USER_VALIDATED, inéligible au publish (EAN délisté, vendeur suspendu canal-side) — argent pris, service non rendu | **INV-8** : `precheck` est **advisory** (UX avant débit — échelle §5 du contrat), jamais le filet de sécurité ; le filet = INV-7. Le débit ne se produit qu'à USER_VALIDATED (invariant existant, réaffirmé). Un échec prévisible au precheck découvert au publish = bug de connecteur |
| **T7** | **Connecteur qui touche l'argent** : un adapter « rend service » et crédite/rembourse lui-même | **INV-9** : `packages/marketplace` n'importe jamais `@flipsync/wallet` ni n'écrit les tables wallet — remboursements uniquement via ListingEngine (contrat §8). Falsifiable par grep d'imports (CI, P5) |

### Bloc C — La négociation (A6)

| id | Scénario d'abus | Invariant tueur |
|---|---|---|
| **T8** | **Double cerveau (violation D4)** : Best Offer natif actif ET Commissaire-Priseur app-side sur le même canal → contre-offres contradictoires, ou double auto-accept = 2 acheteurs sur UN canal | **INV-10** : l'exécuteur d'OfferPolicy est une **fonction pure de `capabilities.negotiation`** (contrat §7) ; sur un canal NATIVE, aucune décision d'offre app-side — propriété P5 : jamais deux moteurs actifs sur un même `(listing, canal)` |
| **T9** | **Offres concurrentes cross-canal** : offres simultanées sur 2 canaux ; `Mission.pendingReason` est mono-slot (P1 §5) → écrasement silencieux, ou accept sur A pendant qu'une offre B est présentée au user | **INV-11** : les décisions d'offres d'un listing sont **sérialisées** (verrou par listing) ; ≤ 1 décision pendante à la fois, aucune offre écrasée en silence (refusée/expirée explicitement) ; toute **acceptation** (humaine ou auto) emprunte le même chemin que SOLD : rétractation immédiate des autres canaux (INV-1), offres entrantes post-acceptation refusées automatiquement. Mécanique de file → P4 |
| **T10** | **Arbitrage de frais (D1)** : un acheteur offre exactement `floorCents` sur le canal aux frais les plus élevés → net vendeur très inférieur à son attente. Mécaniquement licite (plancher BRUT tenu) | Pas d'invariant code — menace de **perception**. Mitigation produit : net estimé par canal affiché à la fixation du plancher (`feeModel`, affichage uniquement — contrat §4/§8). Résiduel accepté, documenté §5 |

Hérités de P1 (déjà propriétés P5) : `∀ offre acceptée ≥ floorCents` ; `auto-accept ⇒ montant ≥ autoAcceptCents ≥ floorCents` ; `qty ≡ 1` par canal.

### Bloc D — Les frontières (canaux, agrégateur, événements)

| id | Scénario d'abus | Invariant tueur |
|---|---|---|
| **T11** | **Rejeu d'événement** : un webhook SOLD rejoué (retry réseau ou malveillance) → double cascade de retract, double transition, double notification | **INV-12** : ingestion idempotente — chaque événement porte une **clé de déduplication** `(channel, eventKey)`. `NormalizedChannelEvent` ne la porte pas encore → **amendement additif A1** au contrat (§5 ci-dessous) |
| **T12** | **Webhook forgé** : un faux SOLD = DoS des ventes (rétracte tous les canaux d'un listing sain) ; un faux OFFER spamme la négociation | **INV-13** : tout webhook est **authentifié** par le connecteur (signature/secret propre au canal ⚠) ; canal sans signature → poll authentifié ; événement non authentifiable = ignoré + journalisé, jamais traité |
| **T13** | **Injection par contenu canal** : `failureReason`, `code`, `text` d'événement hostiles → stored XSS dans la console admin, pollution DB/logs | **INV-14** : toute donnée d'origine canal est **inerte** : sortie `parseEvent` validée Zod (codes SNAKE_CASE par regex), corrélée à une `ChannelPublication` existante (sinon bruit journalisé), échappée au rendu (interdit `dangerouslySetInnerHTML` sur ces champs) |

### Bloc E — Credentials & plateforme (A4, A5)

| id | Scénario d'abus | Invariant tueur |
|---|---|---|
| **T14** | **Fuite de tokens** : un connecteur loggue `accessToken` dans `failureReason`/`externalMeta`/logs → le token du user finit en DB, au dashboard admin, dans les events | **INV-15** : les credentials ne sont jamais sérialisés hors du connecteur — ni events, ni `failureReason`, ni `externalMeta`, ni logs, ni réponse d'API. Chiffrés au repos ⚠ (choix du mécanisme hors P3). Propriété P5 : scan token-like des écritures dans les tests d'intégration |
| **T15** | **Churn sur clé partagée** : UN user en boucle publish/retract (gratuits ou pas) brûle les quotas partenaire → suspension de la clé = panne du canal pour **tous** les users | **INV-16** : quotas par user sur publish/retract/période (données de config, pas de matrix) + compteurs observables au dashboard (DoD observabilité). Le free tier n'exonère pas des quotas |

### Bloc F — La fermeture (A7)

| id | Scénario d'abus | Invariant tueur |
|---|---|---|
| **T16** | **Érosion par commodité** : le prochain `categorieAmazon` « temporaire », le `if (channel === EBAY)` de hotfix dans une route. Aucun attaquant requis — c'est nous, sous pression | **CC-1 … CC-7** outillés : greps en CI (P5) + doctrine et checklist de revue dans CLAUDE.md (P6). La fermeture ne survit que si sa violation casse la CI, pas si elle repose sur la mémoire |

---

## 4. Table consolidée — qui consomme quoi

| Invariant | Falsification / test | Consommateur |
|---|---|---|
| CC-1, CC-2, CC-3, CC-6, CC-7 | greps scoping Core (patterns exacts à figer en P5) | **P5** (CI) + **P6** (doctrine) |
| CC-4, CC-5 | diff-check par PR canal ; diff réel du prochain canal | **P6** (règle de revue) |
| INV-1, INV-2 (double-vente) | propriété : jamais 2 ventes honorées ; latence retract ≤ SLA matrix | **P4** (FSM SOLD + tie-break) puis P5 |
| INV-3 (DIRTY) | tout retract épuisé aboutit à DIRTY + alerte, jamais à un abandon silencieux | **P4** (état) + dashboard |
| INV-4, INV-5 (transport) | SUBMITTED expiré → FAILED ; réconciliation lit le canal | **P4** (timeouts, drift) |
| INV-6 (refund unique) | rejouer failPublish ne rembourse qu'une fois | **P5** (propriété + test existant H3) |
| INV-7 (échec partiel) | le fait PARTIAL_SUCCESS/TOTAL_FAILURE est exposé ; la règle vit en Billing | **Business Policy — hors Core** (P4 §7/§8 fournit le fait) |
| INV-8 (precheck advisory) | un échec precheck-prévisible au publish = bug connecteur | P5 (tests connecteur) |
| INV-9 (wallet interdit) | grep imports `packages/marketplace` | **P5** (CI) |
| INV-10 (un cerveau) | jamais 2 moteurs actifs par (listing, canal) | **P5** (propriété) |
| INV-11 (sérialisation offres) | ≤1 décision pendante ; acceptation ⇒ chemin SOLD | **P4** (file/verrou) puis P5 |
| INV-12 (idempotence events) | rejouer un événement = no-op — requiert **A1** | P4 + P5 |
| INV-13, INV-14 (auth + inertie) | événement non signé/non corrélé/malformé = ignoré-journalisé | P5 (tests hostiles) |
| INV-15 (tokens) | scan token-like des écritures | P5 (CI/tests) |
| INV-16 (quotas) | churn simulé → bloqué + visible | P5 + dashboard |

---

## 5. Sorties nouvelles de P3 (hors menaces)

- **D5 — requalifié au gate P3 (2026-07-13)** : la politique de remboursement en échec partiel
  n'est **pas** une décision d'architecture. Le contrat et la FSM exposent les faits observables
  (`PARTIAL_SUCCESS`, `TOTAL_FAILURE`… — SYNC-FSM §7) ; la règle vit en
  **Business Policy — hors Core** (couche Billing/Product), modifiable sans toucher au domaine.
- **A1 — validé au gate P3, appliqué** : `eventKey: string` obligatoire sur
  `NormalizedChannelEvent` (ADAPTER-CONTRACT §3 amendé) — l'idempotence est une propriété du
  CONTRAT, pas des implémentations. Porteur d'INV-12 ; intégré à C3.

## 6. Résiduels acceptés & hors-scope

- **T10** (perception frais, D1) : résiduel UX accepté — mitigation affichage, jamais de promesse sur le net.
- **Fraude au paiement ON-canal** (chargeback, litige Vinted/LBC) : le produit de la vente est
  encaissé hors FlipSync (contrat §8) — problème du canal et du vendeur, pas de notre FSM.
- **Multi-comptes** (contournement free tier par emails multiples) : v1 magic-link, résiduel
  accepté ; INV-16 borne le rayon (quotas par user, la clé partenaire reste protégée).
- **Console admin** : token inliné, locale/dev uniquement — déjà acté (CLAUDE.md), inchangé ici.
- Enchères / bundles / merchant-of-record : portes fermées en D2/D3/§10 du contrat — aucune
  menace associée à modéliser tant qu'elles restent fermées.

## 7. Feed-forward

- **P4 (SYNC-FSM)** : matière = T1/T2/T3/T9 — tie-break double-SOLD, état DIRTY, timeout
  SUBMITTED, verrou/file d'offres par listing, réconciliation drift (vérité = canal).
- **P5 (INVARIANT-SPEC)** : chaque CC → un check CI (greps scoping figés) ; chaque INV → une
  propriété avec générateurs = séquences d'événements canal (rejoués, désordonnés, hostiles,
  non corrélés) ; hérite des propriétés P1 (floor/auto-accept/qty).
- **P6 (doctrine)** : CC-1…7 → règles CLAUDE.md + checklist de revue « PR canal » ; y graver
  aussi la frontière « Business Policy — hors Core » (D5 requalifiée) et A1.

---
**STOP P3 — franchi au gate du 2026-07-13.** A1 validé (appliqué au contrat) ; D5 requalifié
« Business Policy — hors Core ». → P4 SYNC-FSM.md.
