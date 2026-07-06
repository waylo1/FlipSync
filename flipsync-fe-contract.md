# flipsync-fe-contract.md — Contrat front mobile (P1)

Émis par P1 (Staff). Consommé par P2 (tokens/primitives) et P3 (migration).
Identité « Vide-Grenier Chaleureux ». Backend FIGÉ — le front consomme `@flipsync/core`
(enums générés Prisma = SSOT), erreurs `{ error: 'SNAKE_CASE_CODE' }`, centimes Int + `formatEur`.

## 1. Audit CIBLES (rejoué sur code réel)

| Strate | Constat | Verdict |
|---|---|---|
| Tokens couleur | theme.ts : 8 couleurs chaudes + STATUS_META 11 états | [OK] à étendre (terracotta/bouteille/faïence/brique/kraft) |
| Hex en dur | index.tsx `#2563eb #000 #fff rgba(...)` · validate.tsx `#2563eb #16a34a #dc2626 #d1d5db #111` · login/verify `#2563eb #dc2626` · wallet `#15803D #0F766E #fff #A8A29E` · PriceFlagAlert `#fef3c7 #f59e0b #92400e` | [FAIL] |
| Espacement | 10/14/18/20/22/28/56/110/140… hors grille {4,8,12,16,24,32,48,64} | [FAIL] |
| Rayon | 2/8/10/12/14/18/20/30/36/999 en dur | [FAIL] |
| Ombre | aucune strate — cartes plates bordées uniquement | [FAIL] (tokens à créer) |
| Motion | zéro token, zéro reduced-motion ; ActivityIndicator seul feedback | [FAIL] |
| Icônes | glyphe `⚠` (listings) ; tabs SANS icônes ; lib absente | [FAIL] → lucide-react-native (installée en P2) |
| Primitives | 1 seul composant partagé (PriceFlagAlert) ; boutons/inputs/chips dupliqués ×4 écrans | [FAIL] |
| A11y | 0 accessibilityRole/Label/State ; Switch/chips muets ; cibles < 44 pt (chips 8pt vertical) | [FAIL] |
| Liaison backend | validate.tsx : séquence complète typée + codes erreur mappés ; listings/wallet : MOCK assumé (TODO Sprint 3) | [OK] partiel — états loading/empty/error à normaliser, AUCUN nouveau call (gate) |

## 2. Contrat de composant

Convention commune : props typées `@flipsync/core` ; jamais de Float monétaire ;
statut listing SERVEUR-AUTORITAIRE (jamais optimiste) ; tout `*_FAILED` affiche le
remboursement ; états = idle / loading / error(SNAKE_CASE) / empty.

| Composant | Props (essentiel) | États | Notes autorité |
|---|---|---|---|
| Button (ui) | variant primary·laiton·ghost·danger / loading / icon / onPress | idle·pressed·disabled·loading | cible ≥ 48 pt, role=button |
| Card (ui) | padding? / children | — | ombre `card`, fond card |
| Badge (ui) | fg / bg / icon? / label | — | pill, texte ≥ 12 |
| Field (ui) | label / error? / hint? + props TextInput | idle·focus·error | label lié (accessibilityLabel) |
| ScreenHeader (ui) | title | — | accent laiton, heading 26 |
| EmptyState (ui) | icon / title / body / action? | — | ton chaleureux, jamais culpabilisant |
| ErrorBanner (ui) | message / onRetry? | — | brique + role=alert, liveRegion |
| Skeleton (ui) | width/height/radius | loading | shimmer crème ; statique si reduced-motion |
| AmountText (ui) | cents: number / size? | — | MONO tabular via formatEur — SEUL affichage d'argent |
| StatusBadge | status: ListingStatus | 11 états STATUS_META | AI_PROCESSING respire (reduced-motion: statique) |
| PipelineRail | status: ListingStatus | step 1..7 ou masqué | jamais optimiste — reflète le serveur |
| ListingCard | ListingRow (id, titre, prixCents, status, failureReason, publishedLbc/Vinted, quand) | — | *_FAILED → ligne remboursement |
| TierPicker | value/onChange, prix = TIER_PRICING | — | role=radiogroup |
| PriceFlagAlert | prixPublie/prixHaut (centimes) | — | moutarde, role=alert, non bloquant |
| CaptureButton | capturing/disabled/onPress | idle·capturing·disabled | label "Prendre une photo" |
| RechargeSheet / MagicLinkForm | (existant wallet/login) | idle·busy·sent·error | codes SNAKE_CASE mappés FR simple |

Transitions listing affichables : uniquement celles de la machine CLAUDE.md (11 états).
PUBLISHED, EXPIRED, USER_CANCELLED, *_FAILED = terminaux, aucune action de retour.

## 3. Arborescence cible

```
apps/mobile/src/
  theme.ts          # TOKENS (couleur, space, radius, shadow, motion, font) — SEULE source
  ui/               # primitives génériques (aucune connaissance métier)
    Button.tsx Card.tsx Badge.tsx Field.tsx ScreenHeader.tsx
    EmptyState.tsx ErrorBanner.tsx Skeleton.tsx AmountText.tsx
    useReducedMotion.ts
  components/       # composés métier (connaissent @flipsync/core)
    StatusBadge.tsx PipelineRail.tsx ListingCard.tsx PriceFlagAlert.tsx
```
Frontière : `ui/` n'importe jamais `@flipsync/core` (sauf AmountText→formatEur via theme) ;
`components/` compose `ui/` + types core ; les écrans ne stylent plus rien en dur.

## 4. Gate-list machine-vérifiable

```
G1 grep -rE '#[0-9A-Fa-f]{3,8}' app/ src/components src/ui --include=*.tsx  → 0 (hors theme.ts)
G2 grep -rE '(padding|margin|gap|top|bottom|left|right)[A-Za-z]*: ?(5|6|7|9|10|11|13|14|15|17|18|20|22|26|28|36|40|56)\b' app/ src/ → 0
G3 grep -rP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' app/ src/ → 0 (icônes = lucide-react-native)
G4 grep -rL 'accessibilityRole' $(grep -rl 'Pressable' app/ src/) → 0 fichier
G5 grep -rE 'toFixed\(2\)' app/ src/ hors formatEur/saisie → à justifier (affichage argent = formatEur)
```

Table de correspondance (P3) :
`#2563eb`→terracotta · `#16a34a`→bouteille · `#dc2626`→brique · `#d1d5db`→border ·
`#111`→ink · `#fef3c7/#f59e0b/#92400e`→moutarde{bg,border,fg} · `#15803D`→bouteille ·
`#0F766E`→bouteille · `#A8A29E`→muted · `rgba(0,0,0,.75)`→scrim · pad 10/14→12/16 ·
pad 20/22→16/24 · pad 28→24 · radius 10/12/14→md · 18/20→lg · 30/36/999→pill · 2→xs
