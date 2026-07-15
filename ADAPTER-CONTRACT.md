# ADAPTER-CONTRACT — Port connecteur multi-canal (P2, one-way door, 2026-07-12)

> Ancré sur UNION-STRESS (P1) + arbitrages actés : **D1** plancher BRUT · **D2** enchère hors v1 ·
> **D3** bundles hors v1 · **D4** un seul cerveau de négociation par canal.
> Mandat supplémentaire avant gel : test de fermeture sur 9 marketplaces (§0).
> **Amendement A1** (gate P3, 2026-07-13, validé) : `eventKey` obligatoire sur `NormalizedChannelEvent` (§3) —
> l'idempotence est une propriété du CONTRAT, pas des implémentations.
> Claims plateformes ⚠ = à re-valider contre la doc partenaire au build ; le verdict n'en dépend pas.

---

## 0. Test de fermeture — « brancher un canal sans toucher le core ? »

Canaux testés : eBay, Shopify, Rakuten, Vinted, Leboncoin **+ Amazon, ManoMano, Cdiscount, Etsy**.

### Ce que chaque canal exigerait du modèle P1

| Canal | Négo | Identité produit | Vendeur | Publication | Exigence nouvelle pour le core ? |
|---|---|---|---|---|---|
| eBay | Best Offer natif ⚠ | optionnelle | particulier OK | sync | non (P1 déjà absorbé) |
| Shopify | aucune | composite (product/variant/inventory) | sa propre boutique | sync | non (S3 → identité, déjà vu) |
| Rakuten | aucune ⚠ | **EAN requis** ⚠ | particulier OK ⚠ | sync | non (S6 → precheck) |
| Vinted (agrég. B2B) | offres natives ⚠ | aucune | particulier | sync ⚠ | attributs mode (taille…) requis ⚠ → precheck |
| Leboncoin (agrég. B2B) | messagerie → app-side ⚠ | aucune | particulier | sync ⚠ | non |
| **Amazon** | aucune | **ASIN obligatoire** | plan individuel ⚠ | **async** (processing SP-API) | état de publication asynchrone ; photos perso non affichées sur offre occasion ⚠ |
| **ManoMano** | aucune | EAN fréquent ⚠ | **PRO_ONLY (SIRET)** ⚠ | **async** (feed) ⚠ | éligibilité niveau VENDEUR |
| **Cdiscount** | aucune | EAN requis ⚠ | PRO majoritaire ⚠ | async ⚠ | idem ManoMano |
| **Etsy** | aucune ⚠ | aucune | particulier OK | sync | éligibilité niveau **ITEM** (vintage ≥ 20 ans / handmade / supplies ⚠) |

Enseignement : les 4 nouveaux canaux n'ajoutent **aucun concept de pricing** (tous prix fixe, zéro
négo native — l'union P1 re-modélisée tient). Ils ajoutent des **dimensions d'éligibilité et de
cycle de publication**. ManoMano/Cdiscount sont même inéligibles au C2C v1 — et le modèle les
absorbe quand même (ligne de matrix « PRO_ONLY », canal jamais proposé) : preuve de fermeture par
l'absurde. Etsy prouve que l'éligibilité est une fonction de l'ITEM, pas seulement du canal.

### Leaks restants (réponse : NON en l'état)

| id | Leak | Ancrage | Pourquoi ça casse la fermeture |
|---|---|---|---|
| **L1** | **Catégories par canal DANS le core** : `ListingDraft.categorieLbc/categorieVinted` + colonnes homonymes | [listing.ts:80-81](packages/core/src/types/listing.ts:80), [schema.prisma:76-77](packages/db/prisma/schema.prisma:76) | Canal N+1 ⇒ nouveau champ core + colonne DB + prompt IA + écran mobile. 9 canaux = 9 colonnes. **Le leak structurel.** |
| **L2** | Aucun critère formel d'admission d'un champ au core | — (absence) | Rien n'empêche le prochain `categorieAmazon`. La fermeture doit être une règle écrite, pas une intention. |
| **L3** | Port actuel = `publish()` seul — ni precheck, ni update, ni retract, ni ingestion d'événements | [types.ts:44-47](packages/marketplace/src/types.ts:44) | Sans precheck, EAN manquant (Rakuten/Cdiscount), item inéligible (Etsy), vendeur inéligible (ManoMano) = **échecs tardifs post-débit**. Sans retract normalisé, l'invariant de rétractabilité (P1/S2) n'a pas de porteur. |
| **L4** | Statut publication sans état asynchrone : `'QUEUED'\|'PUBLISHED'\|'FAILED'\|'RETRACTED'` | [schema.prisma:120](packages/db/prisma/schema.prisma:120) | Amazon/feeds : « soumis, en traitement canal » irreprésentable → P4 devrait rouvrir le contrat. |
| **L5** | `externalId String?` scalaire (= P1/S3) | [schema.prisma:121,131](packages/db/prisma/schema.prisma:121) | Shopify (3 ids), Amazon (SKU+ASIN) : ops update/retract impossibles avec un seul id. |

### VERDICT

**KO en l'état** — L1 est la one-way door dangereuse : commitée telle quelle, elle impose une
migration + un prompt + un écran par canal, pour toujours.
**OK après corrections C1–C5** (§11), toutes intégrées au présent contrat. Fermeture alors
falsifiable par la checklist §12. Nuance honnête : ajouter un canal reste « +1 valeur d'enum
`SalesChannel` » = migration DB **additive sans logique** — déclarée acceptable
([schema.prisma:268](packages/db/prisma/schema.prisma:268)) ; l'alternative String+Zod
affaiblirait l'intégrité référentielle pour économiser une migration triviale. Reco : garder l'enum.

---

## 1. Règle de fermeture (doctrine — reprise en P6)

> **Un champ n'entre dans le core que s'il décrit l'objet physique ou le mandat du vendeur,
> indépendamment de tout canal.** Tout ce qui *traduit* (noms de catégories canal, formats d'ids,
> attributs exigés, barèmes de frais) vit dans l'adapter.

Litmus : `ean` passe (propriété de l'objet), `categorieLbc` échoue (vocabulaire d'un canal),
`expedition.formatColis` passe (physique), `asin` échoue (registre Amazon → `externalMeta`).

## 2. Payload canonique (ce que le core tend aux adapters)

```ts
// @flipsync/core — versionné. Centimes Int, EUR-only v1.
interface CanonicalItem {
  titre: string
  description: string
  categorie: CanonicalCategory        // C1 — taxonomie FlipSync, ~12 valeurs, ADR dédié
  etat: ItemCondition
  marque: string | null
  ean: string | null                  // vérité-objet, optionnel (débloque Rakuten/Amazon/Cdiscount)
  photos: readonly { url: string; sha256: string }[]
  expedition: { formatColis: 'S'|'M'|'L'|'XL'; poidsEstimeG?: number } | null // requis avant 1er connecteur réel
}
interface CanonicalListing {
  contractVersion: 1
  listingId: string
  item: CanonicalItem
  pricing: Pricing                    // P1 : { prixCents; offers?: { floorCents; autoAcceptCents? } } — D1 : BRUT
  delivery: DeliveryPreference | null // mandat vendeur (Mission), null = expédition par défaut
}
```

L'adapter résout la catégorie fine du canal à partir de `categorie` + texte (`titre/description/
marque`) — la résolution (table, heuristique, IA) lui appartient, le core n'en sait rien.

## 3. Le port `ChannelConnector`

```ts
interface ChannelConnector {
  readonly channel: SalesChannel   // nom provisoire ⚠ — SSOT code actuelle = `Marketplace` (@flipsync/core) ; arbitrage nommage non tranché, cf. MASTER-REMED Q9 (ERRATA E-7)
  readonly capabilities: ChannelCapabilities            // données statiques (§4)

  /** Éligibilité AVANT authorize/débit. Pur ou I/O léger. Raisons lisibles user. */
  precheck(l: CanonicalListing, seller: SellerContext): Eligibility

  /** Idempotent — clé = (listingId, channel, epoch). Republier ne duplique jamais.
   *  Correction ERRATA E-10 : epoch ajouté (conséquence d'A2/SYNC-FSM §9 — REPUBLISH incrémente
   *  epoch précisément pour qu'un nouveau essai ne soit PAS dédupliqué comme déjà tenté). */
  publish(l: CanonicalListing, c: ChannelCredentials): Promise<PublishOutcome>
  update(ref: PublicationRef, l: CanonicalListing, c: ChannelCredentials): Promise<OpOutcome>
  retract(ref: PublicationRef, c: ChannelCredentials, why: RetractReason): Promise<OpOutcome>

  /** Webhook/poll brut → événement normalisé. null = bruit à ignorer. */
  parseEvent(raw: unknown): NormalizedChannelEvent | null
}

type Eligibility = { eligible: true } | { eligible: false; reasons: IneligibilityReason[] }
type PublishOutcome =
  | { status: 'PUBLISHED'; externalId: string; url: string; externalMeta?: Json } // sync
  | { status: 'SUBMITTED'; submissionRef: string }                                // async (Amazon/feed)
  | { status: 'FAILED'; kind: 'TRANSIENT' | 'PERMANENT'; code: string }           // SNAKE_CASE
// Correction ERRATA E-9 (additive) : formes jusqu'ici référencées mais non définies.
type PublicationRef = { externalId: string; externalMeta?: Json }   // possédé par l'adapter, opaque au core
type OpOutcome =
  | { ok: true }
  | { ok: false; kind: 'TRANSIENT' | 'PERMANENT'; code: string }     // miroir de PublishOutcome.FAILED — porte la distinction consommée par SYNC-FSM §3 (RETRACTING → DIRTY vs retry)
// A1 : eventKey = id d'événement du canal si fourni, sinon hash déterministe
// (type+externalId+payload+discriminant) ⚠ — correction ERRATA E-12 : le discriminant
// (timestamp canal ou curseur de poll) est OBLIGATOIRE dans le fallback ; sans lui, deux
// événements réels identiques (ex. deux offres identiques à 10 min d'écart) collisionneraient
// et le second serait perdu en silence (contraire à INV-11).
// Dédup à l'ingestion par (channel, eventKey) — porteur d'INV-12 (THREAT-MODEL), mécanique → SYNC-FSM.
// Correction ERRATA E-2 (additive, même famille qu'A1) : `pubRef` = clé de corrélation opaque
// (string) vers la ChannelPublication existante (submissionRef tant que SUBMITTED, externalId
// une fois connu) — porteur d'INV-14 (corrélation obligatoire ; absente = bruit journalisé).
// Absente uniquement sur PUBLISH_CONFIRMED, l'événement qui ÉTABLIT externalId (corrélation par
// (listingId, channel, epoch) à l'ingestion — cf. E-10). Nommé `pubRef` (et non `ref`) pour ne
// pas collisionner avec le paramètre `ref: PublicationRef` (objet) des méthodes update/retract.
type NormalizedChannelEvent = { eventKey: string } & (
  | { type: 'PUBLISH_CONFIRMED'; externalId: string; url: string; externalMeta?: Json }
  | { type: 'PUBLISH_REJECTED'; pubRef: string; code: string }
  | { type: 'OFFER_RECEIVED'; pubRef: string; amountCents: number; buyerRef: string }   // → NegotiationService (si APP_SIDE)
  | { type: 'MESSAGE_RECEIVED'; pubRef: string; text: string; buyerRef: string }
  | { type: 'SOLD'; pubRef: string; amountCents: number }                               // → retract des AUTRES canaux (P4)
  | { type: 'RETRACT_CONFIRMED'; pubRef: string }
  | { type: 'LISTING_ENDED'; pubRef: string; cause: 'EXPIRED' | 'CHANNEL_POLICY' }
)
```

Interdits par contrat : aucune méthode enchère (D2), aucune méthode bundle (D3), aucun accès
wallet depuis un connecteur (§8), aucun type spécifique canal exporté hors du package adapter.

## 4. Capability matrix v1 (données, pas de code)

| Canal | Kind | Transport | `negotiation` (D4) | `productRef` | `seller` | `publishMode` | Photos perso | `retractSla` |
|---|---|---|---|---|---|---|---|---|
| EBAY | MP | direct | NATIVE ⚠ | OPTIONAL | INDIVIDUAL_OK | SYNC | oui | borné ⚠ |
| VINTED | MP | agrégateur | NATIVE ⚠ | NONE | INDIVIDUAL_OK | SYNC ⚠ | oui | borné ⚠ |
| LEBONCOIN | MP | agrégateur | APP_SIDE ⚠¹ | NONE | INDIVIDUAL_OK | SYNC ⚠ | oui | borné ⚠ |
| SHOPIFY | SF | direct | NONE | NONE | n/a | SYNC | oui | immédiat |
| RAKUTEN | MP | direct | NONE ⚠ | REQUIRED (EAN) ⚠ | INDIVIDUAL_OK ⚠ | SYNC | oui ⚠ | borné ⚠ |
| AMAZON | MP | direct | NONE | REQUIRED (ASIN) | INDIVIDUAL_OK ⚠ | ASYNC | **non** ⚠ | borné |
| ETSY | MP | direct | NONE ⚠ | NONE | INDIVIDUAL_OK | SYNC | oui | borné |
| MANOMANO | MP | direct | NONE | fréquent ⚠ | **PRO_ONLY** ⚠ | ASYNC ⚠ | oui | — |
| CDISCOUNT | MP | direct | NONE | REQUIRED ⚠ | PRO ⚠ | ASYNC ⚠ | oui ⚠ | — |

¹ APP_SIDE si l'agrégateur expose la messagerie ; sinon dégrade en NONE (politique dormante), jamais un blocage.

Prédicats `precheck` connus : Etsy → item vintage ≥ 20 ans/handmade ⚠ ; Rakuten/Amazon/Cdiscount →
`ean`/ASIN présent ; Vinted → attributs mode ⚠ ; ManoMano/Cdiscount → vendeur pro (v1 : toujours
inéligible). `kind` reste une donnée mémoire du connecteur, jamais stockée
(cohérent [schema.prisma:269-271](packages/db/prisma/schema.prisma:269)).
`feeModel` : estimateur par canal, **affichage uniquement** (D1 — le plancher se compare au BRUT).

Correction ERRATA E-11 : `TIMEOUT_SUBMITTED`/`TIMEOUT_RETRACT` (SYNC-FSM §2/§5) et le mode
d'authentification des événements (webhook signé vs poll — THREAT-MODEL INV-13) ne sont **pas**
des colonnes de cette matrix figée : ce sont des **paramètres de configuration par connecteur**
(mêmes propriétés qu'`auth: Json` opaque, §9), lus par le connecteur lui-même, jamais par le core.

## 5. Dégradation gracieuse — l'échelle

1. **Canal jamais proposé** (matrix : PRO_ONLY, capability absente) — l'UI ne le montre pas.
2. **Inéligible au precheck** (raison lisible : « EAN introuvable », « objet non vintage ») — AVANT débit.
3. **FAILED TRANSIENT** — retry borné, `attempts++` ([schema.prisma:124](packages/db/prisma/schema.prisma:124)).
4. **FAILED PERMANENT** — terminal canal + remboursement via flux existant (`failPublish`).
Un échec prévisible au precheck qui n'est découvert qu'en 3/4 = bug de connecteur, pas de core.

## 6. Cycle de statut `ChannelPublication` (Zod SSOT, DB String — zéro migration)

`QUEUED → SUBMITTED → PUBLISHED → RETRACTED | ENDED` ; `FAILED` atteignable depuis QUEUED/SUBMITTED.
`SUBMITTED` (C4) porte les canaux async. La FSM complète de réconciliation (dont SOLD cross-canal,
races, drift) appartient à **P4** — qui peut étendre ce jeu additivement, pas le contredire.

## 7. Négociation — exécution D4

L'exécuteur de l'OfferPolicy par canal est une **fonction pure de `capabilities.negotiation`** :
- `NATIVE` → l'adapter pousse `floorCents`/`autoAcceptCents` dans le mécanisme du canal au publish
  (ex. Best Offer auto-decline/auto-accept ⚠). Le Commissaire-Priseur n'agit PAS sur ce canal.
- `APP_SIDE` → aucun paramètre poussé ; `OFFER_RECEIVED`/`MESSAGE_RECEIVED` routés vers
  NegotiationService (qualification OFFER / OFFER_AT_FLOOR faite app-side contre `floorCents`).
- `NONE` → prix ferme, politique dormante sur ce canal.
Jamais deux cerveaux sur un canal ; le choix ne dépend jamais de données runtime.

Correction ERRATA E-15 : sur `NATIVE`, une `OfferPolicy` absente (`pricing.offers` non défini) ne
désactive pas le mécanisme natif du canal (ex. Vinted, où l'acheteur peut offrir indépendamment
du vendeur) — elle prive seulement l'adapter de `floorCents`/`autoAcceptCents` à pousser ; le
canal traite alors l'offre selon son propre défaut, hors contrôle FlipSync. Aucune décision D4
modifiée : toujours un seul cerveau, jamais app-side sur `NATIVE`.

## 8. Invariants argent (rappel contractuel)

- Un connecteur ne touche JAMAIS le wallet ; remboursements uniquement via les flux ListingEngine existants.
- Produit de la vente : encaissé sur le compte canal du vendeur, **hors FlipSync** (pas de commission — modèle inchangé).
- `floorCents` comparé au prix BRUT canal (D1) ; nets par canal = estimations d'affichage.
- EUR-only v1 ; centimes Int ; frais de canaux en devise étrangère (Etsy USD ⚠) = affichage estimatif seulement.

## 9. Open-API directe vs agrégateur B2B

Même port dans les deux cas. L'agrégateur (Vinted/LBC) = **une instance de connecteur PAR canal**,
jamais un méga-connecteur : la matrix reste vraie par canal, les limites de l'agrégateur
(latence retract, événements disponibles) deviennent les valeurs de capabilities de CE canal.
Credentials : `ChannelCredentials.auth: Json` opaque par canal ; un provider partagé peut servir
plusieurs canaux (SellerContext), le core n'en connaît pas la forme.

## 10. Hors-scope figé v1

Enchères (D2) · bundles/lots (D3) · multi-devise · **merchant-of-record** (FlipSync vendeur pro
pour le compte des users — seul moyen d'atteindre ManoMano/Cdiscount, mais bascule wallet/payout
complète : one-way door explicitement NON franchie ce soir).

## 11. Corrections C1–C5 — pré-requis au commit du Lot 1 (fenêtre idéale : rien n'est commité)

| id | Correction | Nature | Où |
|---|---|---|---|
| **C1** | `CanonicalCategory` (enum core ~12 valeurs, ADR) ; `ListingDraft.categorie` remplace `categorieLbc/categorieVinted` ; prompt IA produit LA catégorie canonique ; colonnes legacy conservées puis drop avec les adapters Vinted/LBC | Migration + prompt + type | core, db, ai, mobile (affichage) |
| **C2** | `ean String?` + bloc `expedition` (vérité-objet, optionnels, additifs) | Additive | core + db |
| **C3** | Port complet (§3) remplace `MarketplaceConnector.publish()` seul | Refonte package | marketplace |
| **C4** | Union statut += `SUBMITTED` (+ `ENDED`) — Zod seul, DB déjà String | Zod | core |
| **C5** | `ChannelPublication.externalMeta Json?` | Migration additive | db (amender le Lot 1 AVANT commit) |

## 12. Checklist « brancher le canal N+1 » — test de fermeture falsifiable

1. `SalesChannel` += valeur (migration additive, zéro logique).
2. Un package/module connecteur implémentant `ChannelConnector`.
3. Une ligne de capability matrix + prédicats precheck.
4. Une résolution de catégories canonique→canal (possédée par l'adapter).
5. Onboarding credentials (forme opaque).

**Zéro modification** : types core (hors registre §1), wallet, Mission/négociation, routes listing,
mobile. Si un canal futur exige une étape 6 → la fermeture est rompue → retour architecture AVANT
d'implémenter (ne pas « faire rentrer au chausse-pied »).

---
**STOP P2.** One-way door — review critique attendue, à froid, en particulier : §1 (règle de
fermeture), §3 (le port), C1 (taxonomie canonique — la seule correction coûteuse). `[GO]` → P3 THREAT-MODEL.md.
