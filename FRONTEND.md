# FlipSync — Plan front-end « Esprit Vide-Grenier »

> **ÉTAT : EXÉCUTÉ** (P1→P6, 2026-07-06). Contrat : flipsync-fe-contract.md.
> Gates G1–G5 verts, typecheck vert. Reste hors périmètre gates : branchement
> API listings/wallet (mocks assumés) + validation sur device réel.

> Adapté du plan WAYLO (« Calme Souverain », navy/acier) → identité **« Vide-Grenier
> Chaleureux »** : papier crème, laiton chiné, terracotta, vert bouteille. Une app qui
> parle à tout le monde — celui qui vide son grenier le dimanche, pas l'ingénieur.
> Stack réelle : **React Native + Expo** (pas de web, pas de Radix — primitives RN + a11y native).

---

## Audit de l'existant (apps/mobile)

| Strate | Actuel (fichiers) | Verdict |
|---|---|---|
| Tokens couleur | `src/theme.ts` : gold `#C8A96E`, goldDark, goldSoft, ink, paper, card, muted, border + STATUS_META (11 états sémantisés) | [OK] socle chaud présent |
| Hex en dur | **35 hex uniques** hors theme.ts dans `app/**` et `src/**` (badges, fonds, boutons) | [FAIL] gate token |
| Tokens espacement | absents — padding 12/14/… en dur, hors grille | [FAIL] |
| Tokens rayon | absents — borderRadius 2/8/10/12/14/18/20/30/36/999 en dur | [FAIL] |
| Tokens ombre | shadow/elevation inline en dur | [FAIL] |
| Tokens motion | absents — durées/courbes ad hoc, reduced-motion ignoré | [FAIL] |
| Icônes | emojis (📸 🧺 🪙 ✓ ✗ …) dans les 6 écrans + PriceFlagAlert | [FAIL] gate emoji — cible : `lucide-react-native` (lib unique, absente du package.json) |
| Primitives | 0 composant partagé hors PriceFlagAlert ; styles dupliqués écran par écran | [FAIL] |
| A11y | **0** `accessibilityRole`/`accessibilityLabel` dans tout le mobile ; cibles tactiles non garanties ≥ 44 pt | [FAIL] gate a11y |
| Liaison backend | types `@flipsync/core` (enums générés depuis Prisma = SSOT), centimes Int + `formatEur`, erreurs `{ error: 'SNAKE_CASE_CODE' }` | [OK] contrat sain, à généraliser (états loading/error/empty inégaux) |

## Hiérarchie → force → modèle → phase

| # | Rôle | Force appliquée | Modèle | Phase | Cibles |
|---|---|---|---|---|---|
| 1 | Staff Engineer | Gouvernance, gate-list falsifiable, contrat backend | Fable 5 | P1 Contrat | flipsync-fe-contract.md |
| 2 | Frontend Architect (DS mobile) | Strates de tokens, primitives RN, props typées | Opus | P2 Tokens + Primitives | theme.ts, src/ui/ |
| 3 | Mécanique | Find-replace déterministe, idempotent | Haiku | P3 Migration | app/**, src/components/** |
| 4 | Design Engineer | Easing, rythme, profondeur papier, polissage | Sonnet | P4 Rendu | diff |
| 5 | Creative Technologist | Skeleton, micro-interactions porteuses d'état | Sonnet | P5 Raffinement | diff |
| 6 | Staff Engineer (re-audit) | Faire échouer le front, a11y finale | Fable 5 | P6 Gate final | rapport |

Ordre : P1 → P2 → P3 → P4 → P5 → P6. P1 émet `flipsync-fe-contract.md` + table de
correspondance « valeur en dur → token », consommés par P2/P3.
1 branche/phase : `feat/fe-p1-contract` … `feat/fe-p6-audit`.

---

## [SOCLE FLIPSYNC-FE] — coller en tête de CHAQUE prompt

```
CONTEXTE: Front mobile FlipSync (React Native + Expo, Expo Router). Identité
"Vide-Grenier Chaleureux" STRICTE : papier crème, encre chaude, laiton chiné (or existant),
terracotta, vert bouteille, moutarde, brique. Chaleureux ≠ enfantin : sobre, lisible, généreux.
L'APP PARLE À TOUT LE MONDE: microcopy français simple (jamais "FSM", "authorize", "commit"
→ "réservé", "payé", "remboursé"), corps de texte ≥ 15, cibles tactiles ≥ 44 pt.
Backend FIGÉ — ZÉRO nouvelle feature/route/appel inventé. Le front consomme les types
`@flipsync/core` (enums GÉNÉRÉS depuis Prisma = SSOT), les erreurs `{ error: 'SNAKE_CASE_CODE' }`,
et l'ARGENT EN CENTIMES Int affiché via formatEur() — jamais de Float monétaire.
Statuts = STATUS_META (11 états) + PIPELINE_STEPS ; remboursement auto TOUJOURS dit à l'utilisateur.
PÉRIMÈTRE: Interdiction d'explorer le FS hors CIBLES. Info manquante → demander, pas inventer.
CIBLES: apps/mobile/src/theme.ts · apps/mobile/app/(tabs)/{index,listings,wallet}.tsx ·
 apps/mobile/app/{validate,login,_layout}.tsx · apps/mobile/app/auth/verify.tsx ·
 apps/mobile/src/components/PriceFlagAlert.tsx
GATES (ARRÊT immédiat si violé):
 - Espacement hors grille {4,8,12,16,24,32,48,64} → ARRÊT.
 - Valeur en dur (hex/px/ombre/durée) au lieu d'un token theme.ts → ARRÊT.
 - Emoji ou glyphe-icône texte → ARRÊT. Icônes = lucide-react-native, lib UNIQUE.
 - Composant sans a11y (accessibilityRole/Label/State, cible ≥ 44 pt) → ARRÊT.
 - Couleur hors palette répertoriée → ARRÊT.
 - Nouvelle feature/route/mock data → ARRÊT.
 - Montant manipulé en Float ou affiché sans formatEur → ARRÊT.
CONTRAINTES: Zéro blabla. Atomique + idempotent. Commits atomiques taggés.
 Animations = explication d'état système uniquement, jamais décoratif ;
 respecter AccessibilityInfo reduced-motion.
[VERIF] falsifiable en fin de sortie (grep): 0 hex inline hors theme.ts · 0 px hors grille ·
 0 emoji · 0 <Pressable|TouchableOpacity> sans accessibilityRole.
FORMAT: diff unifié si maintenance, fichier complet unique si création. Code brut.
```

---

## P1 — STAFF — Fable 5
Ne produit pas de code, produit le contrat.

```
[MODÈLE: Fable 5] Applique [SOCLE FLIPSYNC-FE]. RÔLE: Staff Engineer. Aucun JSX.
SECTIONS:
1. Audit CIBLES → table [OK]/[FAIL] par strate (tokens, hex, icônes, primitives, a11y, backend).
2. Contrat de composant. Pour chaque item — ListingCard, StatusBadge, PipelineRail (7 étapes),
   WalletCard, AmountText (centimes), TierPicker (SIMPLE/OPTIMIZED/PREMIUM + prix TIER_PRICING),
   PriceFlagAlert, PhotoGrid, CaptureButton, DraftForm, RechargeSheet, MagicLinkForm,
   EmptyState, ErrorState, SkeletonCard — définir { props typées `@flipsync/core` ·
   états idle/loading/error(SNAKE_CASE)/empty · transitions autorisées }.
   Le STATUT LISTING est SERVEUR-AUTORITAIRE, jamais optimiste ; PUBLISHED/EXPIRED/…_FAILED
   irréversibles ; tout *_FAILED affiche le remboursement.
3. Arbo cible src/ui/ (primitives) vs src/components/ (composés) + frontière.
4. Gate-list machine-vérifiable (grep) + table « valeur en dur actuelle → token cible ».
FORMAT: markdown dense, 0 code. Fichier: flipsync-fe-contract.md
```

## P2 — ARCHITECT — Opus
```
[MODÈLE: Opus] Applique [SOCLE] + flipsync-fe-contract.md. RÔLE: Frontend Architect mobile.
SECTIONS:
1. Strates de tokens dans theme.ts (CONSERVER l'existant, étendre):
   - Palette: paper #FAF9F7, card #FFFFFF, kraft #EFE6D8 (fonds chinés), ink #1C1917,
     muted #78716C, border #E7E5E4, laiton = gold #C8A96E/goldDark #A8854B (accent premium
     wallet), terracotta #B8542F (action principale), bouteille #3E6B4F (succès/en ligne),
     moutarde #B45309 (attente), faïence #4A6FA5 (traitement en cours), brique #A63D2F
     (échec — TOUJOURS accompagné du remboursement). Contraste AA sur paper obligatoire.
   - Espacement: space[1..8] = 4/8/12/16/24/32/48/64.
   - Rayon: radius sm 8 / md 12 / lg 16 / pill 999 — angles doux, jamais coupants.
   - Ombre: shadow surface/card/sheet (iOS shadow* + Android elevation) — relief papier
     posé, diffus, JAMAIS de glow coloré.
   - Motion: dur fast 120/base 200/slow 320 ms + ease standard/decelerate/accelerate.
2. Primitives src/ui/ (Pressable-based): Button, Card, Badge, Sheet, Field, Tabs —
   accessibilityRole/Label/State systématiques, hitSlop → cible ≥ 44 pt, focus/pressed visibles.
3. Composants du contrat en compound, props typées `@flipsync/core`, STATUS_META consommé,
   zéro donnée en dur.
FORMAT: fichiers complets. [VERIF]: tous tokens résolus · 0 valeur en dur introduite.
```

## P3 — MÉCANIQUE — Haiku
```
[MODÈLE: Haiku] Applique [SOCLE]. RÔLE: migration mécanique (table P1).
1. Remplacer chaque hex/px/ombre/durée inline par son token. Sans correspondance → ARRÊT + rapport.
2. Remplacer TOUS les emojis/glyphes par lucide-react-native (taille/épaisseur tokenisées) :
   📸→Camera, 🧺/📦→ShoppingBag, 🪙/€→Wallet, ✓→Check, ✗→X, etc.
3. Aligner tout espacement sur la grille ; hors grille → ARRÊT + liste.
FORMAT: diff unifié uniquement. [VERIF]: grep 0 hex · 0 emoji · 0 px hors grille.
```

## P4 — DESIGN ENG — Sonnet
```
[MODÈLE: Sonnet] Applique [SOCLE]. RÔLE: Design Engineer.
1. Motion tokens sur transitions d'état (ouverture sheets, progression PipelineRail,
   apparition des cartes): decelerate à l'entrée, accelerate à la sortie, jamais linear spatial.
2. Profondeur: strates d'ombre papier (carte posée sur l'étal) ; matière = papier kraft,
   carton, étiquette de brocante — AUCUN métal froid, glow ou blur.
3. Rythme (audit): hiérarchie Photo/objet > Prix > Statut > Actions > Historique > Technique.
   Le PRIX est roi (typo MONO tabulaire existante, formatEur).
FORMAT: diff. [VERIF]: 0 linear spatial · 0 ombre hors token · hiérarchie conforme.
```

## P5 — CREATIVE — Sonnet
```
[MODÈLE: Sonnet] Applique [SOCLE]. RÔLE: Creative Technologist.
1. Skeleton + shimmer sobres (crème/kraft) sur loading — listings, wallet, analyse IA.
2. Micro-interactions qui EXPLIQUENT l'état: AI_PROCESSING (respiration lente faïence),
   passage DRAFT_READY (l'étiquette « À valider » se pose), PUBLISHED (tampon bouteille),
   *_FAILED (carte brique + ligne remboursement). Chaque anim supprimable sous
   reduced-motion sans perte d'info.
3. EmptyState chaleureux ("Votre étal est vide — prenez une photo") UNIQUEMENT sur
   routes backend existantes.
CONTRAINTE: 0 animation décorative, 0 particule/confetti.
FORMAT: diff. [VERIF]: chaque anim mappée à un état · reduced-motion respecté.
```

## P6 — STAFF re-audit — Fable 5
```
[MODÈLE: Fable 5] Applique [SOCLE]. RÔLE: gate de sortie. Objectif: FAIRE ÉCHOUER le front.
1. Rejouer la gate-list P1 → table [OK]/[FAIL].
2. A11y: TalkBack/VoiceOver complets · accessibilityRole/Label partout · contraste AA ·
   Dynamic Type sans casse · cibles ≥ 44 pt.
3. Cohérence inter-écrans: marges/typos/boutons/badges identiques. Exception = [FAIL].
4. Liaison backend: 0 donnée en dur · 11 états STATUS_META couverts · statuts non-optimistes ·
   remboursement toujours affiché sur *_FAILED · 0 Float monétaire.
FORMAT: rapport [OK]/[FAIL] + diff correctif minimal si trivial; sinon liste ARRÊT.
```
