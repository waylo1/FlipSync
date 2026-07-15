# INVARIANT-SPEC — Propriétés falsifiables & oracles (P5, 2026-07-13)

> **Objet** : convertir chaque invariant (CC-1…7 de P3, INV-1…25 de P3/P4, propriétés héritées
> de P1) en **vérification exécutable** — check statique CI *ou* propriété avec générateur +
> oracle. C'est la spec de test à coder (Sonnet/Haiku) une fois C1–C5 + A2 appliqués.
> Rien ici ne rouvre une décision ; ce document rend les décisions **surveillables**.
> Périmètre : le système POST-pivot. Les propriétés dont le porteur code n'existe pas encore
> sont marquées `[à coder avec le Lot 1]` — elles cadrent l'implémentation, ne la présupposent pas.

---

## 0. Deux natures de vérification

| Nature | Mécanisme | Rôle | Échoue quand |
|---|---|---|---|
| **STATIC** | grep/AST en CI (pré-commit + pipeline) | Fermeture (CC-*) : empêcher l'érosion | Un symbole interdit apparaît dans un périmètre |
| **PROPERTY** | test basé propriété (générateur → oracle) | Comportement (INV-*) : la FSM/les offres tiennent sous adversité | Un contre-exemple viole l'oracle |

Choix d'outillage (décision ROI, cf. CLAUDE.md « ROI avant dépendance ») :

```
Décision : INSTALLER fast-check (property testing TS)
Justification :
- Valeur immédiate : INV-17/18/22 (monotonie, vente unique, totalité) ne se prouvent que par
  exploration d'espaces de permutations/entrelacements — un fuzzer à shrinking les attrape,
  des tests à la main les manquent. C'est le cœur du risque multi-canal.
- Coût de maintenance : faible, lib pure, zéro runtime en prod (devDependency), API stable.
- Alternatives : tests exemplaires écrits main → couverture illusoire sur des espaces combinatoires ;
  écarté. Générateur maison → réinvente le shrinking, plus cher.
- Moment recommandé : avec le Lot 1 (les propriétés naissent en même temps que la FSM).
Les checks STATIC n'ont besoin d'AUCUNE dépendance (grep + tsc `never`). À installer seul : fast-check.
```

---

## 1. Le modèle de référence (l'oracle central)

La plupart des propriétés FSM se prouvent contre un **modèle abstrait** : une réimplémentation
minimale, en mémoire, de la sémantique de SYNC-FSM (états §1, transitions §3, dédup, monotonie),
**sans I/O**. Le test génère une séquence d'entrées, la joue à la fois dans le modèle et (à terme)
dans le réducteur de production, et compare. Le modèle EST l'oracle exécutable de §3-§8 de la FSM.

```ts
// spec/model/sync-model.ts — vérité de référence, pur, testé contre lui-même d'abord.
type ChannelState = 'QUEUED'|'SUBMITTED'|'PUBLISHED'|'RETRACTING'|'SOLD'
                  | 'OVERSOLD'|'RETRACTED'|'ENDED'|'FAILED'|'DIRTY'
interface Line { channel: ChannelId; state: ChannelState; attempts: number; epoch: number }
interface World { lines: Map<ChannelId, Line>; sale: { channel: ChannelId; eventKey: string } | null
                  seenEventKeys: Set<string> }        // (channel,eventKey) sérialisé

// Réducteur pur : (World, Input) -> { world, effects }. effects = intentions (RETRACT…), jamais d'I/O.
declare function step(w: World, i: Input): { world: World; effects: Effect[] }
```

Le « rang de vérité » qui fonde la monotonie (INV-17) est un ordre partiel explicite sur les
états **de vérité-canal** ; les états de croyance ne sont pas classés (réalignables) :

```ts
// Rang des seuls états attestés par le canal. Plus haut = plus avancé, ne recule jamais.
const TRUTH_RANK: Partial<Record<ChannelState, number>> = {
  SUBMITTED: 1, PUBLISHED: 2, SOLD: 3, ENDED: 3, RETRACTED: 3, // terminaux de vérité = 3
}   // QUEUED/RETRACTING/FAILED/DIRTY/OVERSOLD absents = croyance, hors monotonie
```

---

## 2. Générateurs (fast-check)

| Générateur | Produit | Sert |
|---|---|---|
| `genChannelSet` | 1..5 canaux tirés d'un pool **anonyme** (`C0..C4`, capabilities aléatoires) — **jamais de nom réel** | Force la généricité (INV-23) : un test qui nommerait un canal ne compilerait pas contre ce pool |
| `genCapability` | `{ publishMode: SYNC\|ASYNC, negotiation: NATIVE\|APP_SIDE\|NONE, retractSla, productRef, seller }` | Couverture des classes, pas des marques |
| `genEventStream` | Séquence d'`Input` cohérente-par-construction pour un World, PUIS transformée par les combinateurs ci-dessous | Cœur des propriétés FSM |
| `dup(stream)` | Ré-injecte des événements existants (même `(channel,eventKey)`) k fois | INV-12, doublons |
| `permute(stream)` | Permute l'ordre de livraison en préservant les `eventKey` | INV-17, hors-ordre |
| `interleave(a,b)` | Entrelace deux flux canal indépendants, tous ordres | INV-18/21, concurrence |
| `injectTransient(stream,p)` | Insère des outcomes `FAILED TRANSIENT` avec proba p avant succès | INV-20, retries, indisponibilité |
| `injectCrash(stream)` | Coupe après un commit, rejoue la suite (redémarrage worker) | INV-19, at-least-once |
| `injectHostile(stream)` | Événements non corrélés / `eventKey` absent / codes non-SNAKE / payload XSS | INV-13/14, T12/T13 |

Invariant de méta-test : **tout scénario reste rejouable** — chaque générateur émet un log
sérialisable, le shrinking de fast-check réduit un échec à la séquence minimale (exigence de §0
FSM : « tout scénario rejouable »).

---

## 3. Propriétés FSM — INV-17 … INV-25

> Convention : `∀ stream` = pour tout flux généré ; `replay(w0, stream)` = pli de `step`.
> L'oracle est une assertion sur le World final ou sur la trace des effects.

| id | Propriété (énoncé exécutable) | Générateur | Oracle |
|---|---|---|---|
| **P-17a** | **Commutativité par permutation (hors double-vente)** : `∀ stream` contenant **au plus un** événement `SOLD` toutes lignes confondues, l'état final de vérité (projection sur `TRUTH_RANK`) de `replay(permute(stream))` est **identique** à `replay(stream)` | `permute∘genEventStream` filtré ≤1 `SOLD` | Égalité de la projection vérité de chaque ligne ; les états de croyance peuvent différer transitoirement, pas les terminaux de vérité. Le cas ≥2 `SOLD` (résolution dépendante de l'ordre de commit, first-commit-wins — SYNC-FSM §4, one-way door) est **hors périmètre de P-17a par construction** et couvert exclusivement par P-18 |
| **P-17b** | **Non-recul** : à chaque `step`, `rank(vérité(ligne)) ` est non décroissant ; tout événement de rang inférieur au rang courant produit un **stale-drop journalisé** (effect `STALE_DROP`), jamais une mutation | `permute` + `dup` | ∄ step où le rang vérité diminue ; tout drop est tracé |
| **P-18** | **Vente unique** : `∀ interleave` de plusieurs `SOLD` (y compris un canal rétracté/terminé **avant** la livraison de son propre `SOLD`), le World final a **exactement un** `sale` et exactement une ligne `SOLD` ; tout autre canal ayant livré un `SOLD` concurrent finit soit en `OVERSOLD`, soit sur un terminal avec un incident signalé (statut exact non tranché ici, cf. MASTER-REMED Q10 — correction ERRATA E-5) ; jamais un stale-drop silencieux d'un `SOLD` | `interleave(genSold×k)`, variante avec rétraction d'un canal avant son `SOLD` | `count(state==SOLD)==1 ∧ world.sale≠null ∧ ∀ autre canal ayant livré SOLD : state==OVERSOLD ∨ (terminal ∧ effects∋INCIDENT)` |
| **P-19** | **Cascade atomique** : dès que `world.sale≠null`, la trace contient une intention `RETRACT(SOLD_ELSEWHERE)` pour **chaque** autre ligne non terminale, émise au **même step** que la vente ; `injectCrash` juste après ne perd aucune intention | `genSold + injectCrash` | Effects de la cascade présents et co-datés du commit vente ; après rejeu, ensemble d'intentions inchangé |
| **P-20** | **Terminaison des états I/O** : `∀ injectTransient(p<1)`, toute ligne quitte `QUEUED`/`SUBMITTED`/`RETRACTING` en ≤ `max_attempts+1` steps effectifs (temps logique borné) vers un terminal ou `DIRTY` | `injectTransient` + timers | ∄ ligne dans un état I/O après épuisement des bornes ; `attempts ≤ max` toujours |
| **P-21** | **Liveness post-vente** : sous horloge logique, `∀ canal≠gagnant`, `∃ t ≤ retractSla(canal)+borne_retry` où la ligne n'est plus `PUBLISHED` (→ RETRACTED/ENDED/OVERSOLD/DIRTY) | `genSold` + avance d'horloge | Aucune ligne `PUBLISHED` stable au-delà du SLA après `world.sale≠null` |
| **P-22** | **Totalité** : `∀ (état, input)` généré (y compris `injectHostile`), `step` renvoie sans exception et journalise ; le `switch` de production compile en exhaustif `never` | `genEventStream ∪ injectHostile` sur tous états | Zéro exception non typée ; le compilateur rejette tout état non traité (test de compilation négatif) |
| **P-23** | **Généricité** (STATIC, cf. §5) : le module FSM ne contient aucun nom de canal ; toute branche est fonction de capabilities/état, jamais d'identité | grep §5 | Voir §5, check C-23 |
| **P-24** | **Terminaux absorbants** : `∀ stream` appliqué à un World déjà en `SOLD`/`ENDED`/`RETRACTED`-confirmé, l'état est inchangé (hors `REPUBLISH` qui exige `FAILED` + commande explicite) | `dup` + événements arbitraires post-terminal | Idempotence totale sur les terminaux de vérité |
| **P-25** | **Incidents bruyants** : toute transition entrante vers `DIRTY` ou `OVERSOLD` émet, au **même step**, un effect `ALERT` + un effect `DASHBOARD_EVENT` ; jamais l'un sans l'autre | flux menant à DIRTY (`injectTransient` saturé) / OVERSOLD (`interleave`) | ∀ step entrant en incident : `effects ⊇ {ALERT, DASHBOARD_EVENT}` |

### Propriété d'idempotence de bas niveau (porteuse d'INV-12 / A1)

| **P-12** | **Dédup d'ingestion** : `∀ stream`, `replay(dup(stream, k)) ≡ replay(stream)` pour tout k ; un `(channel,eventKey)` déjà vu ⇒ `step` no-op (aucun effect, aucune mutation) | `dup` avec k∈[2,10] | World et trace d'effects identiques avec ou sans doublons |

---

## 4. Propriétés négociation & argent — INV-6…11 + héritées P1

| id | Propriété | Générateur | Oracle |
|---|---|---|---|
| **P-06** | **Remboursement unique** : rejouer `failPublish`/refund N fois sur un débit ⇒ **un** mouvement wallet ; clé idempotente `(listingId, débit)` dans la même `$transaction` que la transition | Séquence de refunds répétés + `injectCrash` | Solde final = solde initial − coût + 1×remboursement, jamais plus (raffine test H3 existant) |
| **P-09** | **Wallet intouchable par les connecteurs** (STATIC) : `packages/marketplace/**` n'importe pas `@flipsync/wallet` et n'écrit aucune table wallet | grep imports §5 | Check C-09 |
| **P-10** | **Un seul cerveau** : `∀ (listing, canal)`, sur un `OFFER_RECEIVED`, au plus une voie de décision active — `NATIVE` ⇒ 0 décision app-side émise ; `APP_SIDE` ⇒ décision app-side, 0 push natif | `genCapability.negotiation` × `OFFER_RECEIVED` | La voie active est **fonction pure** de `capability.negotiation` ; jamais les deux |
| **P-11** | **Sérialisation des offres** : `∀ interleave` d'offres multi-canal sur un listing, ≤ 1 décision pendante à tout instant ; toute offre non retenue est explicitement `REFUSED`/`EXPIRED` (jamais écrasée) ; une **acceptation** émet la cascade de P-19 | `interleave(genOffer×canaux)` | `pending ≤ 1` à chaque step ; ∄ offre disparue sans effect terminal ; accept ⇒ intentions RETRACT autres canaux |
| **P-P1a** | **Plancher respecté** (hérité P1) : `∀` offre acceptée, `montant ≥ floorCents` | offres aléatoires autour du plancher | Aucune acceptation `< floorCents` |
| **P-P1b** | **Auto-accept borné** (hérité P1) : `auto-accept ⇒ montant ≥ autoAcceptCents ≥ floorCents` | offres + politique générée | Invariant d'ordre jamais violé |
| **P-P1c** | **Quantité unitaire** : `∀ canal`, quantité publiée ≡ 1 | payloads générés | Toute quantité ≠ 1 rejetée à la construction |

> Note D5 (Business Policy — hors Core) : **aucune** propriété n'encode ici de règle de
> remboursement pour échec partiel. P-06 teste l'**unicité** d'un remboursement, pas la
> **décision** de rembourser. La décision vit dans la couche Billing et a sa propre suite, hors
> de ce périmètre — cohérent avec le gate P4.

---

## 5. Checks STATIC — Core Closure (CC-1…7) + INV-9/23

Exécutés en CI, **sans dépendance** (grep/ripgrep + `tsc`). Chaque check définit son **périmètre**
(globs) et son **motif interdit**. Un hit = build rouge, avec le fichier:ligne fautif.

```
POOL = leboncoin|lbc|vinted|ebay|shopify|rakuten|amazon|manomano|cdiscount|etsy   # insensible casse
CORE = packages/core/** packages/wallet/** packages/ai/** apps/api/src/** apps/mobile/src/**
       apps/web/src/** packages/db/prisma/schema.prisma
       (exclus : enum de canaux dans schema.prisma + enums générés ; registre des connecteurs)
```

| Check | Porte | Périmètre | Motif interdit → échec |
|---|---|---|---|
| **C-1/2/6/7** | CC-1,2,6,7 | `CORE` (prompts IA inclus) | identifiant matchant `POOL` (hors ligne d'enum autorisée). Couvre `categorieLbc/Vinted`, colonnes `publishedLbc/…`, prompt, écrans |
| **C-3** | CC-3 | `CORE` hors `packages/marketplace` | comparaison/switch sur une valeur de l'enum canaux (`=== 'EBAY'`, `case SalesChannel.X`). Positions de **type** tolérées |
| **C-09** | INV-9 | `packages/marketplace/**` | `import … '@flipsync/wallet'` ou écriture des tables wallet |
| **C-23** | INV-23 | module FSM | tout token de `POOL` ; + revue : chaque état atteignable pour ≥2 canaux ou une classe |
| **C-reg** | CC-3 (exception) | tout le dépôt | **une seule** énumération exhaustive des canaux autorisée = le registre connecteurs (composition root). Une 2ᵉ = violation |

Ces checks sont l'exécution des « tests de falsification » listés en THREAT-MODEL §1 : ils
**doivent être rouges aujourd'hui** (5 des 7 CC violés) et passer au vert à la livraison de C1.
Les câbler AVANT C1 = le harnais qui prouve que C1 a bien fermé la porte (TDD de la fermeture).
Câblage CI : mode **baseline/expected-fail** dès le départ — les violations connues du
2026-07-13 sont listées et tolérées, tout hit **nouveau** hors baseline bloque immédiatement ;
sinon les commits C2–C5 échoueraient tous une CI strictement rouge avant que C1 ne referme la
porte (correction ERRATA E-6, cf. MASTER-REMED §3.1). Bascule en bloquant intégral (baseline
vidée) à la livraison de C1.

CC-4 et CC-5 ne sont pas grepables (ils portent sur le **diff** d'une PR) : ils restent des règles
de revue (P6) + un test falsifiable a posteriori — le diff réel du 1ᵉʳ canal ajouté (Vinted/LBC).

---

## 6. Matrice de couverture (menace → propriété)

| Origine | Invariant | Vérif | Nature |
|---|---|---|---|
| P3 CC-1,2,3,6,7 | fermeture | C-1/2/6/7, C-3 | STATIC |
| P3 CC-4,5 | fermeture (diff) | revue + diff 1ᵉʳ canal | manuel/observé |
| P4 INV-17 | monotonie / hors-ordre | P-17a, P-17b | PROPERTY |
| P4 INV-18 | double-vente | P-18 | PROPERTY |
| P4 INV-19 | cascade atomique | P-19 | PROPERTY + crash |
| P4 INV-20 | terminaison I/O / retries / indispo | P-20 | PROPERTY |
| P4 INV-21 | liveness post-vente | P-21 | PROPERTY + horloge |
| P4 INV-22 | totalité | P-22 | PROPERTY + `never` |
| P4 INV-23 | généricité | C-23 | STATIC |
| P4 INV-24 | terminaux absorbants | P-24 | PROPERTY |
| P4 INV-25 | incidents bruyants | P-25 | PROPERTY |
| P3 INV-12 / A1 | dédup événements | P-12 | PROPERTY |
| P3 INV-6 | remboursement unique | P-06 | PROPERTY + crash |
| P3 INV-9 | wallet intouchable | C-09 | STATIC |
| P3 INV-10 | un cerveau | P-10 | PROPERTY |
| P3 INV-11 | sérialisation offres | P-11 | PROPERTY |
| P3 INV-13,14 | events hostiles inertes | via `injectHostile` dans P-12/P-22 | PROPERTY |
| P3 INV-15 | tokens non fuités | P-15 (§7) | PROPERTY/scan |
| P3 INV-16 | quotas anti-churn | P-16 (§7) | PROPERTY |
| P1 | floor / auto-accept / qty | P-P1a/b/c | PROPERTY |

Deux invariants de P3 sans porteur FSM sont spécifiés à part (§7) : INV-15 (tokens), INV-16 (quotas).

## 7. Propriétés hors-FSM (complètent la couverture P3)

| id | Propriété | Oracle |
|---|---|---|
| **P-15** | **Non-fuite de credentials** : sur tout scénario, aucun champ persisté ou émis (`failureReason`, `externalMeta`, `ChannelEvent.payload`, logs, réponses API) ne contient de sous-chaîne token-like ; un connecteur qui tente de logger un secret est neutralisé | Scan token-like (entropie/motif) des écritures dans les tests d'intégration connecteur ; 0 hit |
| **P-16** | **Quotas anti-churn** : une boucle publish/retract d'un user dépassant le quota/période est bloquée et émet un événement dashboard ; le free tier n'exonère pas | Simulation de churn : au N+1ᵉ appel, refus + `DASHBOARD_EVENT`, clé partenaire jamais sur-sollicitée |

## 8. Ordre d'implémentation recommandé (pour Sonnet/Haiku)

1. **Checks STATIC (§5) d'abord** — aucune dépendance, rouges immédiatement, deviennent le
   critère d'acceptation de C1/C3/A2. C'est le filet anti-régression posé avant le pivot.
2. **Modèle de référence (§1) + générateurs (§2)** — le socle des propriétés FSM.
3. **P-12, P-17, P-18, P-22** — les quatre reines (dédup, monotonie, vente unique, totalité) :
   elles cadrent le réducteur `step` avant qu'il existe côté prod.
4. **P-19, P-20, P-21, P-24, P-25** — cascade, terminaison, liveness, absorption, incidents.
5. **P-06, P-10, P-11 + P-P1\*** — argent & négociation.
6. **P-15, P-16** — frontières credentials/quotas.

Le modèle de référence est livré et testé AVANT le réducteur de production ; ce dernier est
ensuite écrit pour **égaler le modèle** sous tous les générateurs (model-based testing). Les
propriétés ne présupposent donc pas l'implémentation : elles la spécifient.

## 9. Feed-forward P6

- Les checks STATIC (§5) → à câbler comme **gate de CI** dans CLAUDE.md (règle : « une PR canal
  ne touche que `packages/marketplace/**` ; toute autre modif fait échouer C-1…C-3 »).
- La décision fast-check (§0) → seule dépendance nouvelle, à consigner (ADR bref si le projet en tient).
- `[à coder avec le Lot 1]` : les porteurs (modèle, `step`, journal `ChannelEvent`, fait vente
  set-once) naissent avec C1–C5 + A2 — la suite de propriétés est leur cahier des charges.

---
**STOP P5.** Attente `[GO]` → P6 (doctrine — CLAUDE.md / MASTER-REMED.md).
