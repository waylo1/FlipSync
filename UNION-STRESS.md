# UNION-STRESS — Stress-test du modèle `fixed | auction` (P1, 2026-07-12)

> **Objet testé** : l'union canonique de mode de vente envisagée pour le pivot multi-canal —
> `{ mode:'fixed'; prixCents } | { mode:'auction'; startCents; reserveCents?; endsAt }`.
> Elle n'existe **pas en code** (CODE-MAP §4, grep 0) : c'est un stress-test de design,
> exécuté AVANT que le pivot (Lot 1 non commité) ne fige le contrat. L'adapter P2 mappera
> DANS ce modèle → toute erreur d'axe ici se paie sur chaque connecteur.
> Features plateformes = connaissance générale, chaque claim **à re-valider contre la doc
> partenaire** au moment du build (marquées ⚠). Le verdict ne dépend d'aucun détail contesté.

## 1. Référentiel réel (ce que le code possède déjà)

| Fait | Ancrage |
|---|---|
| Prix canonique actuel : UN prix fixe `prixPublie Int?` centimes + fourchette IA `prixPlancher/prixHaut` | `schema.prisma:79-81` |
| La négociation existe DÉJÀ, hors du pricing : `Mission.prixAffiche/prixMini` + `autoAdjugeAuDessusDuMini` (auto-accept) + NegotiationService | `schema.prisma:149-155` |
| Publication par canal : `ChannelPublication` 1 ligne/listing×canal, `externalId String?` scalaire, `@@unique([channel, externalId])` | `schema.prisma:116-133` |
| Canaux cibles : `SalesChannel = EBAY\|SHOPIFY\|RAKUTEN`, phase 2 += VINTED/LEBONCOIN (agrégateur B2B) | `schema.prisma:268-276` |
| Payload connecteur : `prixCents` unique, 1 `categorie` String, ni EAN ni identité produit | `packages/marketplace/src/types.ts:13-24` |
| Cardinalité : 1 listing = 1 objet unique = 0..1 Mission (`listingId @unique`) | `schema.prisma:147` |

## 2. Stress par feature réelle

| # | Feature | Mappe dans l'union ? | Nature du leak | Gravité |
|---|---|---|---|---|
| S1 | eBay **Best Offer** ⚠ | ni `fixed` pur ni `auction` | la négociation est **orthogonale** au mode, pas un mode | **Structurel** |
| S2 | eBay **enchère vraie** ⚠ | `auction` oui, mais | lifecycle possédé par la plateforme, rétractation non garantie → casse la sync multi-canal | **Structurel** |
| S3 | Shopify **variants** | `fixed` sans friction | leak ailleurs : identité externe **composite** (product+variant+inventory_item) | Contrat P2 |
| S4 | Shopify **inventaire** | `fixed` | quantité>1 / oversell possibles côté canal → invariant `qty ≡ 1` à imposer, pas à modéliser | Invariant P5 |
| S5 | Rakuten **points Club R** ⚠ | `fixed` | prix affiché ≠ net vendeur : le modèle ignore les **frais/financements par canal** | Décision D1 |
| S6 | Rakuten **catalogue EAN** ⚠ | `fixed` | précondition d'identité produit absente du payload → capability, dégradation gracieuse | Contrat P2 |
| S7 | **Bundles/lots** (Rakuten, LBC) | inexprimable | problème de **cardinalité** (N objets/annonce), hors du pouvoir expressif d'une union de pricing | Hors-scope v1 |
| S8 | Vinted/LBC **offres natives** ⚠ | ni l'un ni l'autre | même orthogonalité que S1 — les offres existent sur quasi TOUS les canaux, l'enchère sur UN seul | **Structurel** |

### S1/S8 — La négociation n'est pas un mode (leak fatal n°1)

eBay Best Offer = prix fixe + enveloppe d'offres (`autoDeclinePrice`/`autoAcceptPrice`, contre-offres) ⚠.
Vinted (offres acheteur/baisses aux favoris) et LBC (offres paiement sécurisé) : pareil, natif ⚠.
**FlipSync le prouve déjà dans son propre code** : `Mission.prixMini` = auto-decline,
`autoAdjugeAuDessusDuMini` = auto-accept, sur un listing à prix FIXE (`schema.prisma:149-155`).
Forcer ces cas dans l'union oblige soit à les tordre en `fixed` (perte des seuils), soit à les
déguiser en `auction` (faux : pas de temps limite, pas d'enchère publique liante). Pire :
le même objet serait modélisé différemment selon le canal → le modèle n'est plus canonique.
**Conséquence** : la politique d'offres doit être un champ orthogonal du core, avec deux modes
d'exécution par canal — *déléguée* (poussée native : Best Offer) ou *app-side* (Commissaire-
Priseur sur les canaux sans mécanisme). Un canal = UN cerveau de négociation, jamais deux (→ P3/P4).

### S2 — L'enchère n'est pas un pricing, c'est un lifecycle (leak fatal n°2)

Enchère eBay : le prix final est un **output** (résultat des enchères), pas un input ; fin à date
fixe quoi qu'il arrive ; enchère reçue = engagement de vente ; fin anticipée restreinte/pénalisée
avec des enchères en cours, surtout en fin de vente ⚠. Or toute la réconciliation multi-canal
(P4) repose sur l'invariant « n'importe quelle publication est rétractable rapidement quand
l'objet part ailleurs ». Une enchère vivante viole cet invariant **par construction** : publier
le même objet unique en enchère eBay + prix fixe Vinted = fenêtre de double-vente structurelle,
pas une race. De plus : aucun autre canal cible (Shopify, Rakuten FR, Vinted, LBC) n'a d'enchères —
l'arm `auction` sert 1 canal et empoisonne les invariants des 4 autres.
**Conséquence** : l'enchère, si elle existe un jour, est un **mode de publication channel-exclusif**
(objet verrouillé sur ce canal pendant l'enchère, sync suspendue) avec sa propre FSM — pas une
variante de pricing du core. v1 : absente, porte gardée par la capability matrix (P2).

### S3 — Identité externe composite (leak de contrat, pas de modèle)

Shopify impose product→variant→inventory_item même pour 1 objet unique ; update prix = op variant,
marquer vendu = op inventory, retract = op product. `ChannelPublication.externalId String?` scalaire
+ `@@unique([channel, externalId])` (`schema.prisma:121,131`) ne peuvent pas porter ça.
**Conséquence P2** : `externalId` = id canonique (product_id) + `externalMeta Json?` pour les ids
secondaires, possédé par l'adapter (le core ne connaît jamais la forme interne).

### S5 — Frais et financement par canal (le leak qui touche l'argent)

Points Rakuten financés (boosts vendeur opt-in ⚠), commission Rakuten, final value fees eBay,
frais agrégateur B2B Vinted/LBC, fees paiement Shopify : le NET vendeur diverge du prix affiché,
différemment par canal. Le core actuel promet `prixMini` sans dire si c'est du **brut** (prix
affiché) ou du **net** (poche vendeur). Tant qu'il y avait UN canal simulé sans frais, l'ambiguïté
était invisible ; avec N canaux elle devient un mensonge potentiel à l'utilisateur (« jamais sous
ton prix mini » — lequel ?). L'union n'a pas à porter les frais (donnée de canal → capability
matrix P2), mais le core DOIT fixer la sémantique du plancher. → **Décision D1** ci-dessous.

### S6/S7 — Préconditions et cardinalité

- Rakuten exige un rattachement catalogue (EAN/référence) ⚠ que ni l'IA ni `ListingPayload`
  ne produisent (`types.ts:13-24`). → capability `requiresProductRef` + dégradation gracieuse
  (canal indisponible pour cet objet, jamais d'échec tardif). Contrat P2.
- Bundles : 1 annonce = N objets casse `Mission.listingId @unique` et toute la chaîne wallet/IA
  (1 débit = 1 objet). Aucune union de pricing ne peut l'exprimer — c'est un agrégat composite.
  → **hors-scope v1, décision explicite** (pas de pré-provision YAGNI).

## 3. Verdict

**À RE-MODÉLISER** — pas « étendre » : l'axe du discriminant est faux.
Le vrai axe de variabilité inter-canaux n'est pas le *mode de vente* (l'enchère ne concerne
qu'eBay, et elle est un lifecycle, pas un prix). Les axes réels : (a) politique d'offres —
orthogonale, déjà possédée par Mission ; (b) frais/net par canal ; (c) identité externe ;
(d) préconditions catalogue ; (e) cardinalité. Une union à 2 arms n'en capture aucun, et chaque
arm ajouté aggraverait (validé : tenter d'y faire entrer S1 déforme soit `fixed` soit `auction`).

### Modèle canonique proposé (v1 — l'adapter P2 mappe depuis CECI)

```ts
// @flipsync/core — pricing canonique, tous canaux. EUR-only v1, centimes Int.
interface Pricing {
  prixCents: number                 // prix affiché (brut), choisi par l'utilisateur
  offers?: OfferPolicy              // absent = prix ferme (aucune négociation nulle part)
}
interface OfferPolicy {
  floorCents: number                // = prixMini — auto-decline strict en dessous
  autoAcceptCents?: number          // = autoAdjuge — accept sans validation humaine
}
// PAS d'arm auction. AUCTION = capability absente v1 ; si un jour : mode de
// publication channel-exclusif avec FSM propre (S2), décision séparée.
```

Ce que ça préserve : `prixPublie` existant (aucune migration), Mission = SSOT de l'OfferPolicy,
`ChannelPublication` ligne-par-canal (forme validée), conventions centimes.
Ce que ça exige : sémantique D1 tranchée, exécution de l'OfferPolicy par canal (déléguée vs
app-side) dans la capability matrix P2.

## 4. Décisions à trancher au gate (inputs P2 — one-way doors, à froid)

| id | Décision | Reco Fable | Pourquoi |
|---|---|---|---|
| **D1** | `floorCents` = brut (prix affiché) ou net (poche vendeur) ? | **Brut v1** | Invariant exact et vérifiable (comparaison au prix, zéro dépendance aux barèmes de frais qui dérivent) ; le net devient un affichage estimatif par canal dans l'UI. Passer au net = promesse dépendante de tables de frais externes → violable à notre insu. |
| **D2** | Arm `auction` : différée (capability absente v1) ? | **Oui, différer** | 1 seul canal concerné, lifecycle incompatible avec l'invariant de rétractabilité qui fonde la sync (S2). Revenir dessus quand eBay-enchères sera un besoin réel client. |
| **D3** | Bundles/lots : hors-scope v1 ? | **Oui** | Cardinalité étrangère à tout le pipeline actuel (wallet, IA, Mission). Re-modélisation dédiée si le besoin émerge. |
| **D4** | Négociation par canal : UN cerveau (déléguée XOR app-side), jamais les deux ? | **Oui, invariant** | Deux moteurs d'offres simultanés sur le même canal = états incohérents garantis (feed P3/P4). |

## 5. Feed-forward

- **P2** : l'adapter mappe `Pricing`+`OfferPolicy` → payload canal ; capability matrix doit exposer
  `offersNative`, `feeModel`, `requiresProductRef`, `auction:absent`, `retractLatency`.
- **P3** : abuse-cases à creuser — arbitrage de frais inter-canaux (D1), double-cerveau d'offres (D4),
  fenêtre de double-vente si D2 était refusée.
- **P4** : invariant fondateur de la sync = rétractabilité bornée de toute publication ; les offres
  cross-canal convergent vers UNE décision (Mission.pendingReason est mono-slot — collision à modéliser).
- **P5** : propriétés déjà extraites — `qty ≡ 1` par canal ; `∀ offre acceptée ≥ floorCents` ;
  `auto-accept ⇒ montant ≥ autoAcceptCents ≥ floorCents` ; EUR-only ; centimes Int partout.

---
**STOP P1.** Attente `[GO]` (+ arbitrages D1–D4) pour ouvrir P2 — ADAPTER-CONTRACT.md.
