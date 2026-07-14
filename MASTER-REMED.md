# MASTER-REMED — Cristallisation & feuille de route (P6, 2026-07-13)

> **Aucune décision nouvelle ici.** Ce document récapitule P1→P5, ordonne la remédiation et
> consigne les questions ouvertes. La doctrine applicable vit dans CLAUDE.md
> (« Doctrine multi-canal » + « Architecture Freeze ») ; les preuves dans les artefacts.

---

## 1. Artefacts & gates

| Phase | Artefact | Gate | Sorties actées |
|---|---|---|---|
| P1 | UNION-STRESS.md | ✅ validé | Union `fixed\|auction` rejetée → `Pricing + OfferPolicy` ; D1–D4 |
| P2 | ADAPTER-CONTRACT.md | ✅ validé | Fermeture OK après C1–C5 ; port `ChannelConnector` ; capability matrix 9 canaux ; règle de fermeture §1 |
| P3 | THREAT-MODEL.md | ✅ validé | CC-1…7 ; T1–T16 / INV-1…16 ; **A1** validé (eventKey au contrat) ; **D5 requalifié** Business Policy — hors Core |
| P4 | SYNC-FSM.md | ✅ validé | FSM 10 états, croyance/vérité, first-commit-wins (encadré figé), vue agrégée dérivée ; INV-17…25 ; **A2** (schéma additif) |
| P5 | INVARIANT-SPEC.md | ✅ validé | Checks STATIC C-* + propriétés P-* ; modèle de référence ; décision ROI **fast-check** (seule dépendance) |
| P6 | CLAUDE.md (doctrine + freeze) + slash commands + ce document | — | Cristallisation, zéro décision nouvelle |
| Audit | ERRATA.md → ERRATA-RESOLVED.md | ✅ appliqué | Audit adversarial (17 findings E-1…E-17) ; corrections de cohérence appliquées, zéro one-way door rouvert ; Q9/Q10 ajoutées ici (§4) |

## 2. Decision record

| id | Décision | Où | Statut |
|---|---|---|---|
| D1 | `floorCents` = BRUT (prix affiché canal) | UNION-STRESS §4 / ADAPTER-CONTRACT §8 | Figée |
| D2 | Enchères hors v1 (capability absente) | UNION-STRESS §4 / ADAPTER-CONTRACT §10 | Figée |
| D3 | Bundles/lots hors v1 | UNION-STRESS §4 / ADAPTER-CONTRACT §10 | Figée |
| D4 | Un cerveau de négociation par canal | UNION-STRESS §4 / ADAPTER-CONTRACT §7 | Figée |
| D5 | ~~Politique de remboursement partiel~~ → **requalifiée** : Business Policy — hors Core | THREAT-MODEL §5 / SYNC-FSM §8 | Requalifiée (gate P3→P4) |
| A1 | `eventKey` obligatoire sur `NormalizedChannelEvent` | ADAPTER-CONTRACT §3 | Appliqué |
| A2 | Schéma additif Lot 1 : `epoch`, journal `ChannelEvent` unique `(channel,eventKey)`, fait vente set-once, timestamps I/O | SYNC-FSM §9 | À intégrer au Lot 1 |
| — | Tie-break double-vente = first-commit-wins | SYNC-FSM §4 (encadré) | Figée, ne pas rouvrir |
| — | INSTALLER fast-check (devDependency, unique ajout) | INVARIANT-SPEC §0 | Actée (format ROI) |
| Q9 | Nommage canonique de l'enum canaux : `Marketplace` (tranchée 2026-07-14, `SalesChannel` banni) | ADAPTER-CONTRACT §3 | Tranchée |
| Q1 | `CanonicalCategoryId` = référentiel versionné (pas un enum `CanonicalCategory`) ; Core manipule l'id, mapping vers taxonomie canal dans chaque connecteur | ADR-010 | Tranchée (2026-07-14) |

## 3. Ordre de remédiation — avant tout commit du Lot 1

> Rappel : **rien du pivot n'est commité** — la fenêtre C1–C5+A2 est ouverte. Un commit par
> tâche atomique.

1. **Checks STATIC** (INVARIANT-SPEC §5) câblés en CI en mode **baseline/expected-fail**
   (correction ERRATA E-6) : les violations connues du 2026-07-13 (5/7 CC, cf. THREAT-MODEL §1)
   sont listées et tolérées ; tout hit **nouveau** hors baseline est bloquant dès cette étape.
   Le harnais se pose AVANT la porte sans bloquer les commits 2–6 qui la referment. Bascule en
   bloquant intégral (baseline vidée) à l'étape 7.
2. **ADR `CanonicalCategoryId`** — tranché (ADR-010, Q1) : référentiel versionné, pas un enum ;
   Core manipule l'id, mapping vers taxonomie canal dans chaque connecteur.
3. **C1** taxonomie canonique — **fait** : `categorieId` (CanonicalCategoryId) remplace
   `categorieLbc`/`categorieVinted` dans core/db/prompt IA/API ; `V1_CATEGORY_FIELD` supprimé de
   `publication.service.ts`. Mobile inchangé (aucun affichage catégorie n'existait).
4. **C2** `ean` + `expedition` (additif) — **fait** : `Expedition` (core), colonnes `ean`/`expedition`
   (Listing) ; sans producteur (prompt IA non touché, hors scope C2). **C4** union statut +=
   `SUBMITTED` (Zod seul) — **fait** : `RemoteListingStatus.SUBMITTED` (`ENDED` déjà présent).
5. **C5 + A2** — **fait** : `ListingPublication.externalMeta/epoch/submittedAt/retractStartedAt` ;
   tables `ChannelEvent` (journal dédup) et `SaleFact` (vente set-once, INV-18). Dormant — aucun
   producteur/consommateur, `@@unique([listingId, marketplace])` inchangée (clé d'idempotence
   avec epoch = évolution de C3, hors périmètre ici).
6. **C3** : refonte `packages/marketplace` sur le port complet (`ChannelConnector`).
7. Checks STATIC **verts** → commit du Lot 1 (pivot DB).
8. Modèle de référence + les 4 reines (P-12/17/18/22), puis le reste de la suite (ordre INVARIANT-SPEC §8).
9. Adapters réels Vinted/LBC — **premier test grandeur nature de CC-5 : le diff est la preuve.**

Hors périmètre Fable (suivis existants) : findings FLIPSYNC-AUDIT restants, hébergement
inférence prod (décision Maxime en attente, Sprint 4).

## 4. Questions ouvertes — découvertes P1–P6, NON résolues (revue ultérieure)

> Règle : on n'y répond pas ici. Chaque Qn sera tranchée à froid, avec mise à jour de
> l'artefact concerné si la réponse touche le freeze.

| id | Question | Bloque |
|---|---|---|
| **Q1** | Taxonomie `CanonicalCategory` : quelles ~12 valeurs ? Politique d'évolution de l'enum (ajouter une valeur = migration + re-mapping de N connecteurs — qui arbitre, à quelle cadence ?) | C1 (ADR requis) |
| **Q2** | Annulation de commande canal-side (sortie d'`OVERSOLD`) : quels canaux la permettent ⚠ ? Procédure humaine sur un canal SANS annulation possible — à définir avant le premier couple de canaux réels | Rien (v1 mono-puis-bi-canal) |
| **Q3** | Chiffrement au repos des tokens OAuth vendeurs (INV-15) : mécanisme non choisi (colonne chiffrée applicative vs KMS/secret manager) | Onboarding credentials réels |
| **Q4** | `Mission.pendingReason` mono-slot vs sérialisation des offres (INV-11/P-11) : la structure de file par listing n'est pas conçue — extension additive probable du modèle Mission | Multi-canal avec offres sur ≥2 canaux |
| **Q5** | Projection `ListingStatus` ← vue agrégée : mapping exact (quelles vues ⇒ `PUBLISHED`/`PUBLISH_FAILED` ?) non spécifié — compat mobile à préserver | Lot 1 (peut se figer au moment du câblage) |
| **Q6** | Réconciliation : capacité de lecture directe (poll) par canal ⚠ — à inventorier connecteur par connecteur au build ; sans lecture, quel succédané acceptable ? | Aucun (dégrade en événements seuls) |
| **Q7** | Sémantique d'exécution de l'outbox (INV-19) : at-least-once ⇒ les effets (RETRACT…) doivent être idempotents côté worker — contrainte d'implémentation à formaliser au Lot 1 | Implémentation cascade |
| **Q8** | Quotas anti-churn (INV-16) : valeurs des seuils par période — Business Policy, à fixer hors Core | Rien (config) |
| **Q10** | Un `SOLD` livré sur un canal déjà terminal (`RETRACTED`/`ENDED`, rétracté avant que son `SOLD` n'arrive) : stale-drop ordinaire (INV-24 actuel) ou incident signalé (alerte, cohérent avec l'esprit « jamais silencieux » d'INV-25/T2) ? Représente un acheteur ayant payé (ERRATA E-5) | Implémentation de la FSM (P-18 en dépend) |

> Q1 et Q9 : tranchées 2026-07-14, déplacées au Decision record (§2).

## 5. Règle permanente

Tout nouveau problème d'architecture découvert en implémentation : **ne pas résoudre à chaud** —
l'ajouter ici (Qn suivant), continuer sur le chemin non bloqué, revue à froid avec gate.
Les slash commands (`/closure-check`, `/pr-canal`, `/arch-gate`) appliquent la doctrine ;
la modifier exige une session d'architecture et la mise à jour des artefacts sources.
