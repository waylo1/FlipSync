# ERRATA-RESOLVED — Corrections de cohérence appliquées (2026-07-13)

> Suite d'exécution de ERRATA.md. Aucune décision d'architecture nouvelle, aucun one-way door
> rouvert. Deux findings (E-5, E-7) ont produit une Question ouverte au lieu d'une décision —
> conformément à ERRATA.md, qui l'exigeait explicitement plutôt que de trancher à chaud.

| Finding | Status | Artefacts |
|---|---|---|
| E-1 | Corrigé | INVARIANT-SPEC.md §3 (P-17a restreinte à ≤1 SOLD) |
| E-2 | Corrigé | ADAPTER-CONTRACT.md §3 (`pubRef` ajouté aux variantes d'événement) |
| E-3 | Corrigé | SYNC-FSM.md §3 (diagramme), §4 (garde uniforme de l'écriture du fait vente) |
| E-5 | Corrigé + Question ouverte | INVARIANT-SPEC.md §3 (P-18 assoupli) ; MASTER-REMED.md §4 (Q10) |
| E-6 | Corrigé | MASTER-REMED.md §3 (mode baseline/expected-fail) ; INVARIANT-SPEC.md §5 (note croisée) |
| E-7 | Question ouverte (non tranché) | MASTER-REMED.md §4 (Q9) ; ADAPTER-CONTRACT.md §3 (annotation provisoire) |
| E-4 | Corrigé | THREAT-MODEL.md §1 (registre fixé dans `packages/marketplace/src/registry.ts`) |
| E-8 | Corrigé | INVARIANT-SPEC.md §5 (`apps/web/src/**` ajouté au glob `CORE`) |
| E-9 | Corrigé | ADAPTER-CONTRACT.md §3 (`PublicationRef`, `OpOutcome` définis) |
| E-10 | Corrigé | ADAPTER-CONTRACT.md §3 (clé d'idempotence `publish()` → `(listingId, channel, epoch)`) |
| E-11 | Corrigé | ADAPTER-CONTRACT.md §4 (timeouts/auth événements requalifiés config connecteur, hors matrix) |
| E-12 | Corrigé | ADAPTER-CONTRACT.md §3 (discriminant obligatoire dans le hash fallback d'`eventKey`) |
| E-13 | Corrigé | CLAUDE.md (annotations mono-canal historique → Doctrine/D5) |
| E-14 | Corrigé | SYNC-FSM.md §10 (INV-19 : `⟺` → `⇒`) |
| E-15 | Corrigé | ADAPTER-CONTRACT.md §7 (cas `NATIVE` + `OfferPolicy` absente précisé) |
| E-16 | Corrigé | CLAUDE.md (transport Vinted/LBC aligné sur la matrix ADAPTER-CONTRACT §4) |
| E-17 | Corrigé | THREAT-MODEL.md (INV-1 aligné sur P-21) ; SYNC-FSM.md §3 (`TIMEOUT_RETRACT` nommé) |

---

## Corrections additionnelles (passe de cohérence, hors liste ERRATA)

- **Collision de vocabulaire introduite par E-2** : le champ de corrélation ajouté aux
  événements portait initialement le nom `ref`, identique au paramètre `ref: PublicationRef`
  des méthodes `update`/`retract` (types différents — string vs objet). Renommé `pubRef` sur
  `NormalizedChannelEvent` (ADAPTER-CONTRACT.md §3) pour lever l'ambiguïté.
- **Table des gates** (MASTER-REMED.md §1) et **liste des artefacts source** (CLAUDE.md,
  Doctrine multi-canal) : ligne ajoutée pour ERRATA.md → ERRATA-RESOLVED.md, pour que la
  cristallisation P6 référence aussi la passe d'audit qui l'a suivie.

## Vérification croisée

- **Architecture Freeze (CLAUDE.md)** : les 15 points relus après application des 17 corrections
  — aucun n'est touché. Pricing+OfferPolicy, règle de fermeture, port 5 méthodes, FSM 10 états,
  first-commit-wins, Business Policy — hors Core, argent, merchant-of-record hors-scope, C1–C5+A2
  restent inchangés au mot près.
- **MASTER-REMED.md** : Decision record (§2) inchangé ; Questions ouvertes (§4) passées de 8 à 10
  (Q9, Q10 ajoutées, aucune répondue) ; ordre de remédiation (§3) précisé sur le mode CI (E-6),
  pas réordonné.
- **Références de section** : les renvois croisés ajoutés (§4 ADAPTER-CONTRACT ↔ §9 SYNC-FSM ↔
  P-18/P-21 INVARIANT-SPEC ↔ Q9/Q10 MASTER-REMED) pointent vers des sections existantes après
  édition — aucun lien mort introduit.
- **Vocabulaire** : `pubRef` vs `PublicationRef` désormais distincts sans collision ;
  `SalesChannel` vs `Marketplace` reste une divergence **assumée et tracée** (Q9), pas résolue —
  conforme à l'instruction de ne jamais trancher seul un point qui engagerait un renommage de
  code.
- **Termes figés** : aucun terme d'un one-way door (Pricing, OfferPolicy, `ChannelConnector`,
  `CanonicalItem`/`CanonicalListing`, capability matrix, FSM 10 états, first-commit-wins,
  Business Policy) n'a changé de nom ou de définition.

---

**Architecture inchangée. Seules des corrections de cohérence ont été appliquées.**
