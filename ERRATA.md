# ERRATA — Audit final de cohérence (reviewer externe, 2026-07-13)

> Audit adversarial des 7 artefacts (UNION-STRESS, ADAPTER-CONTRACT, THREAT-MODEL, SYNC-FSM,
> INVARIANT-SPEC, MASTER-REMED, CLAUDE.md doctrine). **Rien n'est corrigé ici.** Aucun point
> ci-dessous ne rouvre un one-way door : toutes les corrections minimales sont documentaires
> ou additives. Chaque finding est falsifiable — vérifier la citation avant d'agir.

---

## CRITICAL

### E-1 · P-17a contredit first-commit-wins — propriété insatisfaisable telle qu'écrite
- **Où** : INVARIANT-SPEC §3 P-17a vs SYNC-FSM §4.
- **Pourquoi** : P-17a exige que `replay(permute(stream))` donne une projection de vérité
  **identique**. Or le tie-break first-commit-wins est **volontairement dépendant de l'ordre** :
  permuter deux `SOLD` de canaux distincts échange gagnant et perdant → la ligne A finit `SOLD`
  dans un ordre, `PUBLISHED`+`OVERSOLD` dans l'autre. Les projections diffèrent par construction.
- **Impact** : la suite de propriétés serait rouge contre une implémentation **correcte** —
  la propriété reine est fausse, pas le code.
- **Correction minimale** : reformuler P-17a en commutativité **quotientée par le tie-break** :
  égalité des projections *modulo l'identité du canal gagnant* (exactement un SOLD, les autres
  invariants préservés), ou restreindre P-17a aux flux à ≤ 1 `SOLD` et couvrir le cas multi-SOLD
  par P-18 seul.

---

## HIGH

### E-2 · `NormalizedChannelEvent` n'a pas de clé de corrélation
- **Où** : ADAPTER-CONTRACT §3 vs THREAT-MODEL INV-14.
- **Pourquoi** : INV-14 exige que tout événement soit « corrélé à une ChannelPublication
  existante ». Or les variantes `SOLD`, `RETRACT_CONFIRMED`, `LISTING_ENDED`,
  `OFFER_RECEIVED`, `MESSAGE_RECEIVED` ne portent **aucune référence** (ni `externalId`, ni
  `PublicationRef`). A1 a ajouté la dédup (`eventKey`), pas la corrélation.
- **Impact** : le port est inimplémentable tel quel — l'ingesteur ne peut pas router un `SOLD`
  vers la bonne ligne.
- **Correction minimale** : amendement additif (même famille qu'A1) — champ commun
  `externalId` (ou `ref`) sur l'enveloppe `{ eventKey } & (…)`.

### E-3 · FSM : un `SOLD` pendant `RETRACTING`/`DIRTY` ne peut jamais gagner la vente
- **Où** : SYNC-FSM §3 (arêtes `RETRACTING → OVERSOLD`, `DIRTY → OVERSOLD`) vs §4
  (« Gagnée → `PUBLISHED|SUBMITTED → SOLD` »).
- **Pourquoi** : le retrait a trois causes (`SOLD_ELSEWHERE | USER | POLICY`). Si la cause est
  USER/POLICY, **aucun fait vente n'existe** : le mécanisme §4 (écriture set-once) *gagnerait*,
  mais la table de transitions force `OVERSOLD` — dont la sémantique (« 2ᵉ vente à annuler »)
  ferait annuler une **première** vente légitime sans en enregistrer aucune. La FSM contredit
  son propre tie-break.
- **Impact** : vente réelle annulée à tort + `world.sale = null` — violation de l'esprit
  d'INV-2 (une vente honorée) dans un cas concurrent non couvert.
- **Correction minimale** : la garde de l'arête `SOLD` est **l'issue de l'écriture du fait
  vente**, uniformément depuis {SUBMITTED, PUBLISHED, RETRACTING, DIRTY} : gagnée → `SOLD`,
  perdue → `OVERSOLD`. Aucun état nouveau.

### E-4 · Emplacement du registre des connecteurs : contradiction entre trois textes
- **Où** : THREAT-MODEL §1 (« Core = … apps/api **hors enregistrement des connecteurs** »)
  vs CC-3 (« UNE énumération autorisée = le registre ») vs `/pr-canal` (périmètre d'un diff
  canal = enum + `packages/marketplace/**` + config).
- **Pourquoi** : si le registre vit dans `apps/api` (comme l'exclusion du THREAT-MODEL le
  suggère), ajouter un canal exige d'éditer `apps/api` → la première PR canal réelle sera
  marquée ❌ par `/pr-canal` et par CC-4/5, alors qu'elle est conforme.
- **Impact** : l'outillage de fermeture se contredit lui-même au premier usage réel — perte de
  crédibilité du gate, contournements « exceptionnels » qui érodent la doctrine.
- **Correction minimale** : fixer le registre DANS `packages/marketplace` (un chemin exact,
  unique) et retirer l'exclusion `apps/api` du périmètre Core — cohérent avec la lettre de CC-3.

### E-5 · Oracle P-18 sur-contraint + drop silencieux d'un `SOLD` sur ligne terminale
- **Où** : INVARIANT-SPEC §3 P-18 (« `count(OVERSOLD)==k-1` ») vs SYNC-FSM INV-24.
- **Pourquoi** : entrelacement légal — la cascade rétracte le canal B (`RETRACTED`, terminal)
  **avant** que le `SOLD` de B ne soit livré ; INV-24 l'absorbe en stale-drop → `OVERSOLD`
  compte k-2. L'oracle échoue sur une trace correcte. Aggravant : ce `SOLD` représente un
  acheteur **qui a payé** — le réduire à un stale-drop journalisé contredit l'esprit
  « jamais silencieux » (INV-25/T2).
- **Impact** : faux négatif du test ; oversell réel invisible hors journal.
- **Correction minimale** : oracle P-18 = « exactement 1 `SOLD` ∧ fait vente unique ∧ tout
  autre canal dont le `SOLD` est livré finit en `OVERSOLD` **ou** en terminal avec incident
  signalé » ; et requalifier `SOLD`-sur-terminal d'alerte (pas de stale-drop ordinaire) —
  à consigner en Question ouverte, pas à trancher ici.

### E-6 · MASTER-REMED étape 1 : une CI bloquante et rouge avant C1 bloque les étapes 2–6
- **Où** : MASTER-REMED §3.1 (« câblés en CI — rouges attendus ») + INVARIANT-SPEC §5
  (« un hit = build rouge »).
- **Pourquoi** : les étapes 2–6 sont des commits ; si les checks sont rouges ET bloquants dès
  l'étape 1, chaque commit intermédiaire échoue la CI — y compris ceux qui corrigent.
- **Impact** : pipeline gelé ou (pire) habitude de bypasser la CI dès sa naissance.
- **Correction minimale** : câbler en mode **baseline/expected-fail** (les violations connues
  du 2026-07-13 sont listées et tolérées ; tout hit NOUVEAU est bloquant), basculer en
  bloquant intégral à la livraison de C1.

### E-7 · Nommage de l'enum canaux : `SalesChannel` (artefacts) vs `Marketplace` (SSOT code)
- **Où** : ADAPTER-CONTRACT §3/§12, SYNC-FSM, CLAUDE.md doctrine (grep
  `SalesChannel\.|Marketplace\.`) vs le code actuel — fix F5 (commit ba22ca7) a fait de
  `Marketplace` la SSOT dans `@flipsync/core`.
- **Pourquoi** : aucun artefact ne décide si le pivot renomme `Marketplace` → `SalesChannel`,
  étend `Marketplace`, ou fait coexister les deux. C'est précisément la triple nomenclature
  que F5 venait d'éliminer.
- **Impact** : re-création de la double vérité de nommage au Lot 1 ; les greps de fermeture
  visent un nom qui n'existera peut-être pas.
- **Correction minimale** : une ligne de décision de nommage (UN nom canonique, l'autre banni)
  à acter avant le Lot 1 — Question ouverte Q9, pas un choix à faire dans cet errata.

---

## MEDIUM

### E-8 · Périmètre Core incohérent : `apps/web` couvert par CC-7 mais absent d'INVARIANT-SPEC
- **Où** : THREAT-MODEL CC-7 et `/closure-check` incluent `apps/web/src` ; INVARIANT-SPEC §5
  `CORE` ne le liste pas.
- **Impact** : un check CI codé depuis INVARIANT-SPEC laisserait la console admin fuir des
  noms de canaux sans échec.
- **Correction minimale** : ajouter `apps/web/src/**` au `CORE` d'INVARIANT-SPEC §5.

### E-9 · `OpOutcome` et `PublicationRef` jamais définis dans un contrat figé
- **Où** : ADAPTER-CONTRACT §3 (signatures `update`/`retract`) ; SYNC-FSM §3 s'appuie sur la
  distinction `TRANSIENT|PERMANENT` **du retract** pour les boucles `RETRACTING → DIRTY`.
- **Impact** : ambiguïté au cœur du port — chaque connecteur inventera sa forme, la FSM ne
  pourra pas discriminer transient/permanent uniformément.
- **Correction minimale** : préciser (additif) `OpOutcome` en miroir de `FAILED` de
  `PublishOutcome` (`kind: TRANSIENT|PERMANENT`), et la forme de `PublicationRef`
  (`externalId` + `externalMeta`).

### E-10 · Clé d'idempotence de `publish()` : le contrat dit `(listingId, channel)`, A2 exige l'epoch
- **Où** : ADAPTER-CONTRACT §3 (« Idempotent — clé = (listingId, channel) ») vs SYNC-FSM §9
  (`epoch`, REPUBLISH).
- **Impact** : un REPUBLISH après FAILED serait dédupliqué comme « déjà tenté » par un
  connecteur conforme à la lettre du contrat.
- **Correction minimale** : note additive au contrat — la clé devient
  `(listingId, channel, epoch)` (conséquence d'A2, pas une réouverture).

### E-11 · Dimensions de capability référencées mais jamais déclarées dans la matrix
- **Où** : SYNC-FSM §2/§5 (« TIMEOUT_SUBMITTED : donnée de matrix ») ; THREAT-MODEL INV-13
  (webhook signé vs poll — transport d'événements par canal). La matrix figée (ADAPTER-CONTRACT
  §4) n'a ni colonne timeout, ni colonne transport/authentification d'événements.
- **Impact** : concepts utilisés avant définition ; chaque implémenteur les rangera où il veut.
- **Correction minimale** : déclarer les deux dimensions (additif — la matrix est des données) ;
  sinon les requalifier explicitement « config connecteur, hors matrix ».

### E-12 · Fallback hash d'`eventKey` peut avaler deux événements légitimes identiques
- **Où** : ADAPTER-CONTRACT §3 (commentaire A1 : « sinon hash déterministe (type+externalId+payload) »).
- **Pourquoi** : deux `OFFER_RECEIVED` identiques (même montant, même buyerRef, à 10 min
  d'écart) sur un canal sans id d'événement produisent le même hash → le second, réel, est
  dédupliqué.
- **Impact** : offre acheteur perdue silencieusement — contraire à INV-11 (« aucune offre
  écrasée en silence »).
- **Correction minimale** : imposer un composant discriminant (timestamp canal ou curseur de
  poll) dans le hash fallback — précision d'implémentation, à noter au contrat.

### E-13 · CLAUDE.md : les sections historiques fossilisent la règle de remboursement que D5 a expulsée
- **Où** : CLAUDE.md « Machine à états ListingStatus » (« Remboursement wallet auto sur
  AI_FAILED et PUBLISH_FAILED ») et « Publication marketplace » (« Échec → PUBLISH_FAILED +
  remboursement automatique ») vs Doctrine (« Business Policy — hors Core »).
- **Pourquoi** : ces phrases mono-canal encodent exactement la règle métier que le gate P3→P4
  a requalifiée hors Core ; à N canaux elles redeviennent l'ambiguïté T5.
- **Impact** : deux sources de vérité dans LE fichier de doctrine — un futur agent suivra
  l'une ou l'autre au hasard.
- **Correction minimale** : annoter les deux mentions « mono-canal historique ; à N canaux,
  cf. Doctrine/D5 » — doc-only.

---

## LOW

### E-14 · INV-19 écrit en `⟺` alors que seul `⇒` est voulu
THREAT-MODEL/SYNC-FSM : un retract USER crée des intentions sans vente — la réciproque du
`⟺` est fausse. Corriger en `vente commitée ⇒ intentions co-commitées`.

### E-15 · « offers absent = aucune négociation nulle part » (UNION-STRESS) intenable sur canaux à offres natives toujours actives
Sur Vinted ⚠, l'acheteur peut offrir que le vendeur le veuille ou non. Le comportement
« politique absente × capability NATIVE » n'est défini nulle part. À préciser (une ligne au
contrat §7) sans changer la décision.

### E-16 · Transport Vinted/LBC : la matrix fige « agrégateur », CLAUDE.md historique dit « direct ou agrégateur Lengow »
Divergence informationnelle ; la matrix étant des données révisables, aligner le texte historique.

### E-17 · Bornes temporelles : THREAT-MODEL INV-1 promet « fenêtre ≤ max(retractSla) », P-21 borne à « retractSla + budget retries »
La borne du threat model est plus stricte que celle que la FSM garantit ; de plus
`TIMEOUT_RETRACT` est déclaré (SYNC-FSM §2) mais aucune arête ne le cite nommément
(l'« épuisement » de `RETRACTING → DIRTY` doit explicitement inclure le timeout). Harmoniser
les deux énoncés sur la borne réelle.

---

## Synthèse

| Sévérité | Findings | Nature dominante |
|---|---|---|
| Critical | E-1 | Propriété insatisfaisable (spec de test contredit une décision figée) |
| High | E-2…E-7 | Trous de contrat (corrélation, gagnant du tie-break), contradictions d'outillage (registre, CI rouge), nommage |
| Medium | E-8…E-13 | Périmètres et types sous-spécifiés, dérives contrat↔FSM |
| Low | E-14…E-17 | Formalisation et alignements de texte |

Aucun finding ne remet en cause : le modèle Pricing+OfferPolicy, la règle de fermeture, le
port en 5 méthodes, la FSM à 10 états, first-commit-wins, ni la frontière Business Policy.
Les défauts trouvés sont des **incohérences de jointure** entre artefacts et des oracles/périmètres
mal calibrés — tous corrigeables par amendements additifs ou annotations, aucun par réouverture
d'un one-way door. E-3 et E-5 méritent traitement avant l'implémentation de la FSM ; E-6 avant
de câbler la CI ; E-7 avant le Lot 1.

---
*Audit exécuté en lecture seule. Aucun artefact modifié.*
