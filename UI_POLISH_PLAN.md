# FlipSync Mobile — Plan de polissage UI/UX

> **Rôle pour l'exécutant (Sonnet).** Tu n'ajoutes **aucune** fonctionnalité, aucune
> logique métier, aucun changement d'archi. Tu es Senior Product Engineer : tu améliores
> uniquement la **qualité perçue** de `apps/mobile`. Chaque pixel doit avoir une raison.
> Tu ne touches **jamais** au backend (`apps/api`, `packages/*`).

Ce document est un audit + une liste d'actions **ordonnée**. Fais les chantiers **dans l'ordre**,
**un écran à la fois**, entièrement, puis teste sur device, puis commit, puis passe au suivant.

---

## Règles d'exécution (non négociables)

1. **Un chantier = un écran (ou une primitive) = un commit atomique.** Jamais grouper deux sujets.
   Format : `refactor(mobile/<scope>): …` ou `feat(mobile/ui): …` pour une primitive.
2. **Après chaque chantier**, dans `apps/mobile` :
   - `npx tsc --noEmit -p .` doit être **vert** (zéro `any`, `strict` respecté).
   - Vérifier sur le **device réel** branché (adb) — voir « Workflow de vérification » en bas.
     Le bug de rendu Android (§ Transverse T2) ne se voit QUE sur device, pas au typecheck.
3. **Zéro valeur en dur.** Toute couleur/espace/rayon/typo vient de `src/theme.ts`
   (`theme`, `space`, `radius`, `font`, `line`, `motion`, `tracking`). Gate G1/G2 du contrat FE.
4. **Données réelles uniquement.** Interdit d'inventer une métrique, un compteur, un état.
   Si une donnée n'existe pas côté app, on ne l'affiche pas.
5. **Observabilité (DoD gouvernance) :** ces changements sont purement visuels, ils ne
   produisent aucune donnée métier → **exemptés** de dashboard. Ne PAS ajouter de `dev.track()`.
6. **Animations** : 120–220 ms. Les tokens `motion.dur` sont déjà à `{fast:120, base:200, slow:320}`.
   N'introduis jamais une durée > `motion.dur.base` (200 ms) sur une transition d'interaction.

### NE PAS FAIRE (hors périmètre — piège)

- ❌ Ajouter un bouton « Recharger » au Wallet → **pas d'endpoint**, c'est du backend.
- ❌ Rendre le switch « Recharge automatique » modifiable → lecture seule assumée (pas d'endpoint).
- ❌ Ajouter écran/onglet/champ. On **retire** et on **resserre**, on n'ajoute pas de surface.
- ❌ Toucher à la machine à états, au wallet, aux appels API, aux stores. Pur presentational.

---

## Problèmes transverses (à traiter aux étapes indiquées)

### T1 — Safe-area jamais branché → **Étape 0**
`react-native-safe-area-context@4.10.5` et `expo-status-bar@1.12.0` sont **installés** mais
inutilisés. `app/_layout.tsx` rend un `<Stack>` nu, sans `SafeAreaProvider`, sans `<StatusBar>`.
Conséquence : chaque écran simule l'inset haut avec un `paddingTop` en dur, **incohérent** :
- `ScreenHeader` (Home, Wallet) → `paddingTop: space[8]` (64)
- Profile / Processing / listing-view / listing-edit → `paddingTop: space[7]` (48)
- `vendre.tsx` → commandes basses à `bottom: space[7]` (48) en dur (ne respecte pas l'inset bas)

### T2 — Bug de rendu Android « padding sur chips répétés » → **Étapes 4, 5, 6**
Déjà corrigé sur Home (chips filtres) : un `padding`/`paddingHorizontal`/`paddingVertical` sur
un `Pressable`/`View` **répété via `.map()`** corrompt le rendu du texte (glyphes tronqués) sur
le device de test (Android 16). Le même pattern subsiste :
- `validate.tsx` → `styles.chip` (L339-348 : `paddingHorizontal: space[4]`, `paddingVertical: space[2]`)
- `listing-edit.tsx` → `styles.chip` (L258-267, identique)
- `vendre.tsx` → `styles.tierChip` (L324-332 : `paddingVertical/paddingHorizontal: space[2]`)

**Pattern bug-safe de référence** (celui qui a réparé Home, cf. `index.tsx` styles.chip L240-250) :
pas de `padding` sur le chip. À la place → `height` fixe + `alignItems/justifyContent: 'center'`,
et l'air horizontal vient d'une **`marginHorizontal` sur le `<Text>` interne** (une marge, jamais
un padding). Toujours **re-vérifier sur device** après conversion.

### T3 — Code mort : composant `ListingCard` → **Étape 8 (nettoyage)**
`src/components/ListingCard.tsx` (145 lignes) n'est **monté nulle part** : Home rend `ListingTile`.
Seul le **type** `ListingRow` en est importé (`index.tsx`, `ListingTile.tsx`).

### T4 — Header « retour + titre » dupliqué 4× → **Étape 0**
`profile.tsx`, `processing.tsx`, `listing-view.tsx`, `listing-edit.tsx` réécrivent chacun le même
en-tête (Pressable back + titre, `paddingTop: space[7]`). Divergences d'alignement garanties.
→ Extraire un `StackHeader` partagé (fait aussi le safe-area de l'étape 0).

---

## Ordre d'exécution

| # | Chantier | Fichiers | Pourquoi ici |
|---|----------|----------|--------------|
| 0 | Fondation safe-area + StatusBar + StackHeader | `_layout.tsx`, `ScreenHeader.tsx`, nouveau `StackHeader.tsx`, 4 écrans stack | Home en dépend (top padding) |
| 1 | **Home** | `(tabs)/index.tsx` | Demandé en premier |
| 2 | Profile | `profile.tsx` | Simple, fort impact, colle au brief |
| 3 | Wallet | `(tabs)/wallet.tsx` | Hiérarchie du solde |
| 4 | Field + counter, puis Validate | `ui/Field.tsx`, nouveau `ConditionChips.tsx`, `validate.tsx` | Écran le plus long |
| 5 | Listing-edit | `listing-edit.tsx` | Réutilise `ConditionChips` |
| 6 | Vendre (caméra) | `(tabs)/vendre.tsx` | Dense, moins prioritaire |
| 7 | Login + Verify | `login.tsx`, `auth/verify.tsx` | Polish formulaire |
| 8 | Nettoyage (ListingCard mort) | `ListingCard.tsx`, `ListingTile.tsx`, `index.tsx` | Après stabilisation |

---

## Étape 0 — Fondation (prérequis Home)

**Fichiers :** `app/_layout.tsx`, `src/ui/ScreenHeader.tsx`, **nouveau** `src/ui/StackHeader.tsx`,
puis `profile.tsx`, `processing.tsx`, `listing-view.tsx`, `listing-edit.tsx`.

**Constat :** T1 + T4. Insets fakés en dur, incohérents ; header stack copié 4×.

**Actions :**
1. `app/_layout.tsx` : envelopper le `<Stack>` dans `<SafeAreaProvider>` (import
   `react-native-safe-area-context`) et ajouter `<StatusBar style="dark" />` (`expo-status-bar`).
2. `ScreenHeader.tsx` : remplacer `paddingTop: space[8]` par l'inset réel —
   `const insets = useSafeAreaInsets()` puis `paddingTop: insets.top + space[3]`.
   (ScreenHeader est partagé Home + Wallet : cette seule correction sert les deux.)
3. Créer `src/ui/StackHeader.tsx` : `{ title: string; right?: ReactNode }`, bouton retour
   (`ArrowLeft`, `router.back()`, `hitSlop`, cible `MIN_TOUCH`), titre `font.title`/`line.title`/700,
   `paddingTop: insets.top + space[3]`, `paddingHorizontal: space[5]`, `paddingBottom: space[3]`.
   Reprendre exactement les styles `header`/`back`/`headerTitle` déjà dans `listing-view.tsx`.
4. Remplacer les 4 en-têtes dupliqués par `<StackHeader title="…" />`. Supprimer leurs styles
   `header`/`back`/`headerTitle` devenus morts + imports `ArrowLeft` inutiles.
5. `vendre.tsx` : `styles.controls.bottom` → `insets.bottom + space[4]` (au lieu de `space[7]`) ;
   `styles.topOverlay.top` → `insets.top + space[3]` (au lieu de `space[7]`). Passer par un style
   inline calculé (les insets ne sont pas dispo dans `StyleSheet.create`).

**Critères d'acceptation :**
- Aucun `paddingTop: space[7|8]` résiduel pour un en-tête d'écran.
- StatusBar en contenu **sombre** sur fond papier (texte lisible en haut).
- Sur device : gap haut identique et « juste » (ni collé, ni trop d'air) ; commandes caméra
  au-dessus de la barre de gestes système.

**Commits :**
- `refactor(mobile): branche safe-area + StatusBar — fin des insets hauts en dur`
- `refactor(mobile/ui): StackHeader partagé — dédup des 4 en-têtes stack`

---

## Étape 1 — Home (`app/(tabs)/index.tsx`)

**Constat :** avant la 1ʳᵉ annonce, l'œil traverse header + barre de recherche + rangée de chips
+ jusqu'à 2 bandeaux (`AnalysisQueueBanner`, `PendingPublishBanner`). La 1ʳᵉ rangée de tuiles peut
tomber sous la ligne de flottaison. Les chips filtres ont `minWidth: 90` (héritage du fix bug, pas
un choix esthétique) → 5 chips forcent toujours un scroll horizontal. Le skeleton de chargement
(`skeletonGrid`, `width:'47%'`, flexWrap) n'a pas la même géométrie que la vraie grille (`FlatList`
`numColumns=2`) → saut visuel au chargement.

**Actions :**
1. **Densité verticale** : `searchWrap.marginBottom` `space[3]→space[2]` ;
   `chipsScroll.marginBottom` `space[3]→space[2]`. Objectif : 1ʳᵉ rangée de tuiles visible sans
   scroll sur un écran standard (≈ 6,1"). Mesurer sur device.
2. **Chips filtres compacts (bug-safe)** : garder `height: 44` + centrage, **remplacer
   `minWidth: 90`** par un dimensionnement au contenu → retirer `minWidth`, déplacer l'air
   horizontal sur le `<Text>` via `chipText.marginHorizontal: space[3]` (marge, pas padding →
   sûr, cf. T2). Les 5 chips tiennent alors presque sans scroll. **Vérifier device** : si des
   glyphes retronquent, revenir au `minWidth` fixe et documenter.
3. **Skeleton aligné** : remplacer `skeletonGrid` (flexWrap) par la même métrique que la grille
   réelle — 2 colonnes, même `gap: space[3]`, tuiles en `aspectRatio: 1` (comme `ListingTile`).
   Aucun saut de layout entre skeleton et données.
4. **Copie** : placeholder recherche `"Rechercher dans mes annonces"` → `"Rechercher une annonce"`.

**Critères :** 1ʳᵉ rangée visible sans scroll ; chips lisibles (0 glyphe tronqué sur device) ;
aucun saut skeleton→grille ; typecheck vert.

**Commit :** `refactor(mobile/home): densité verticale, chips compacts bug-safe, skeleton aligné`

---

## Étape 2 — Profile (`app/profile.tsx`)

**Constat (colle au brief PROFILE) :** le corps de l'écran = **3 lignes placeholder « Bientôt »**
(Notifications, Recharge automatique, Aide et contact) — non fonctionnelles, pur bruit. Le bloc
identité est très aéré. La déconnexion (ghost, en bas) est correcte mais peu distinguée.

**Actions :**
1. **Supprimer les 3 `SettingRow` « Bientôt »** et le composant `SettingRow` lui-même + imports
   Lucide devenus inutiles (`Bell`, `RefreshCcw`, `CircleHelp`) + la `Card` « Paramètres ».
   (Brief : « Supprimer tout texte inutile ».)
2. **Mettre en avant une info réelle** à la place : email (déjà présent) + **version de l'app**
   en ligne discrète (`Constants.expoConfig?.version` — donnée réelle, pas inventée). Rien d'autre.
3. **Isoler la déconnexion** : la pousser clairement à part (séparateur fin `theme.border` ou
   espace `space[6]` au-dessus). Garder `variant="ghost"` + icône `LogOut` (déconnexion ≠ perte
   de données, donc pas `danger`). Elle reste la seule action de l'écran.
4. Resserrer le bloc identité (réduire `identity.marginTop` / `gap`).

**Critères :** aucun « Bientôt » ; écran compris en < 2 s ; version affichée = valeur réelle ;
déconnexion nettement séparée.

**Commit :** `refactor(mobile/profile): retrait des placeholders, info réelle, déconnexion isolée`

---

## Étape 3 — Wallet (`app/(tabs)/wallet.tsx`)

**Constat :** le solde est déjà le héros (`font.balance` 44, carte bouteille, `shadow.sheet`) — bon.
Mais juste dessous, la carte **« Recharge automatique » (lecture seule, souvent désactivée)** est
le 2ᵉ élément visuel — une action secondaire non fonctionnelle trop en avant (brief : « actions
secondaires trop visibles »).

**Actions :**
1. **Renforcer la primauté du solde** : s'assurer que rien ne rivalise juste dessous. Garder le
   footer « X rechargés au total » discret (déjà `onDarkMuted`/`caption`).
2. **Démoter le bloc auto-recharge** : soit le déplacer **sous** l'Historique, soit le réduire à
   **une ligne compacte** (label + switch) au lieu d'une `Card` pleine. Il reste (donnée serveur
   réelle) mais cesse d'être le n°2 visuel. Ne PAS le rendre modifiable (§ NE PAS FAIRE).
3. Homogénéiser les espacements de section (`section.marginTop` cohérent partout).

**Critères :** l'œil va au solde immédiatement ; l'auto-recharge n'est plus le 2ᵉ bloc ;
espacements réguliers. **Pas** de bouton « Recharger » ajouté.

**Commit :** `refactor(mobile/wallet): solde renforcé, auto-recharge démotée`

---

## Étape 4 — Field (compteur) + Validate (`app/validate.tsx`)

**Constat :** écran le plus long de l'app. Sous-titre long. La réassurance « rien n'est débité »
est répétée **3×** (sous-titre + hint bas + dialog de confirmation). Le bloc « Formule » = label +
hint + boîte listant `cumulativeTierFeatures` ligne par ligne → beaucoup de vertical pour une info
**secondaire et verrouillée**. Chips État = pattern padding-bug (T2). Titre a `maxLength={120}`
mais **aucun compteur** (brief FORMULAIRES : « compteur quand pertinent »).

**Actions :**
1. **Primitive `Field`** (`src/ui/Field.tsx`) : ajouter une prop optionnelle `showCount?: boolean`.
   Quand `true` **et** `maxLength` défini, afficher un compteur discret `value.length/maxLength`
   aligné à droite sous le champ (`font.caption`, `theme.muted`, `tabular-nums`). Aucune régression
   sur les champs existants (défaut `false`).
2. **Composant `ConditionChips`** (`src/components/ConditionChips.tsx`) : extraire les chips État
   (partagés avec listing-edit, étape 5). Signature :
   `{ value: ItemCondition | null; onChange: (c: ItemCondition) => void }`. Style **bug-safe**
   (pas de padding sur le Pressable répété : `height`/`minHeight` + centrage + `marginHorizontal`
   sur le Text). `accessibilityRole="radio"` conservé.
3. **Validate** :
   - Compresser le sous-titre en une ligne discrète (`font.small`, `theme.muted`).
   - **Dédupliquer** « rien n'est débité » : le garder **une seule fois** (hint final sous le
     bouton). Le retirer du sous-titre.
   - Bloc **Formule** : remplacer label + hint + `tierSummary` (liste multi-lignes) par **une
     ligne info discrète** style « ℹ️ Formule {label} · {prix} · verrouillée à la capture ».
     Retirer la liste `cumulativeTierFeatures` détaillée (verbeuse, secondaire).
   - Remplacer les chips inline par `<ConditionChips value={etat} onChange={setEtat} />`.
   - `<Field label="Titre" … showCount />`.
   - Clavier : `ScrollView keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"`.

**Critères :** moins de scroll ; « rien n'est débité » dit **1 fois** ; compteur Titre visible ;
chips lisibles device ; typecheck vert.

**Commits :**
- `feat(mobile/ui): Field — compteur de caractères optionnel`
- `refactor(mobile/ui): ConditionChips partagé — chips État bug-safe`
- `refactor(mobile/validate): compaction Formule, réassurance dédupliquée, compteur, clavier`

---

## Étape 5 — Listing-edit (`app/listing-edit.tsx`)

**Constat :** le hint haut est verbeux — **c'est l'exemple exact du brief** :
« Les photos ne sont plus modifiables une fois l'annonce validée. Vos autres corrections sont
gratuites. » L'action **destructive** (« Annuler l'annonce », `variant="danger"`) est collée sous
« Enregistrer » à **poids visuel égal** (même largeur pleine, `marginTop: space[2]`) → brief :
« actions dangereuses séparées ». Chips État = padding-bug (T2). Conditions dupliquées avec
validate. Hint bas peut afficher une phrase amputée quand `prixPublie === null`.

**Actions :**
1. **Condenser le hint haut** → `"ℹ️ Photos verrouillées après validation. · Corrections gratuites."`
   (exactement le format demandé par le brief).
2. **Isoler l'action destructive** : ajouter un séparateur (`space[6]` + trait `theme.border`)
   au-dessus de « Annuler l'annonce ». La rendre visuellement **secondaire** — pas un bouton plein
   identique à « Enregistrer ». Garder `variant="danger"` mais réduire sa prééminence
   (p. ex. l'éloigner nettement + label sans emphase). Le CTA principal reste « Enregistrer ».
3. Remplacer les chips inline par `<ConditionChips … />` (réutilise étape 4).
4. Corriger le hint bas : ne rien afficher (ou une phrase complète) si `prixPublie === null`,
   jamais une phrase commençant par une valeur vide.
5. `<Field label="Titre" … showCount />`.

**Critères :** hint court ; destructive nettement séparée et secondaire ; chips lisibles ;
pas de phrase amputée ; typecheck vert.

**Commit :** `refactor(mobile/listing-edit): hint condensé, action destructive isolée, chips partagés`

---

## Étape 6 — Vendre / caméra (`app/(tabs)/vendre.tsx`)

**Constat :** overlay dense (jauge + 3 chips formule au-dessus du viseur). Le CTA affiche
`"Rédiger (${photos.length}/${MAX_PHOTOS})"` → le `/6` (MAX, pas le seuil du palier) est du bruit
et prête à confusion. Chips formule = padding sur scrim (T2, risque moindre mais réel).

**Actions :**
1. **CTA** : simplifier. Sous le seuil → `"Encore N photo(s)"` (déjà bon) ; seuil atteint →
   simplement `"Rédiger"` (retirer le `(n/6)`).
2. **Chips formule** : convertir au pattern bug-safe (pas de `paddingVertical/Horizontal` sur le
   `Pressable` répété). Vérifier le rendu sur device.
3. Safe-area bas/haut : déjà traité à l'étape 0 (`controls`, `topOverlay`).
4. Alléger l'overlay **sans retirer de fonction** : resserrer les gaps de `topOverlay` si l'air
   est excessif. Ne pas déplacer le choix de formule (décision de flux, hors périmètre visuel).

**Critères :** CTA clair (pas de `/6`) ; chips lisibles device ; commandes en safe-area ;
aucune fonction retirée.

**Commit :** `refactor(mobile/vendre): CTA clarifié, chips formule bug-safe`

---

## Étape 7 — Login + Verify (`app/login.tsx`, `app/auth/verify.tsx`)

**Constat :** écran propre et centré. Manque le polish formulaire du brief : pas d'`autoFocus`,
pas de soumission au clavier. Rythme vertical légèrement irrégulier (`container gap: space[3]` +
`Field.label marginTop: space[3]` se cumulent).

**Actions :**
1. **Login** : `Field email` → `autoFocus` (brief : « focus automatique si pertinent » — cas
   classique) + `onSubmitEditing={() => void sendLink()}` + `returnKeyType="send"`. Vérifier que
   le rythme vertical reste régulier (ajuster le `gap` si le cumul label+gap crée un trou).
2. **Verify** : aligner la typo de l'écran d'erreur sur l'échelle (`heading`/`line.heading` pour
   le titre « Lien invalide »), cohérent avec les autres H1.

**Critères :** clavier ouvert au focus email ; « envoyer » du clavier déclenche l'envoi ; rythme
régulier ; typecheck vert.

**Commit :** `refactor(mobile/login): focus auto, envoi au clavier, rythme homogène`

---

## Étape 8 — Nettoyage transverse

**Constat :** T3 — `ListingCard` est mort. `processing.tsx` `RunningCard` a un corps de 3 phrases
condensables.

**Actions :**
1. Déplacer le **type** `ListingRow` hors de `ListingCard.tsx` (dans `ListingTile.tsx` en tête,
   ou un `src/components/listing.types.ts`). Mettre à jour les imports (`index.tsx`, `ListingTile.tsx`).
2. **Supprimer** `src/components/ListingCard.tsx` (composant + styles, 145 lignes).
3. `processing.tsx` : condenser le texte `runningBody` (1–2 phrases max, garder l'essentiel :
   « fermez l'app si vous voulez, la rédaction continue sur nos serveurs »).

**Critères :** `ListingCard` supprimé, aucun import cassé, typecheck vert.

**Commits :**
- `chore(mobile): supprime le composant mort ListingCard, déplace le type ListingRow`
- `refactor(mobile/processing): copie condensée`

---

## Consolidations optionnelles (si le temps le permet, après l'étape 8)

- **Primitive `Chip` unique** : il existe aujourd'hui 3 systèmes de chips (filtres Home, État
  validate/edit, formule vendre). Les unifier en un seul `src/ui/Chip.tsx` bug-safe résoudrait
  définitivement T2 et garantirait l'homogénéité. À ne faire qu'une fois les écrans stabilisés,
  en commit dédié `refactor(mobile/ui): Chip unique`.

---

## Workflow de vérification (obligatoire à chaque chantier)

1. Serveur Metro : `npm run dev` (racine) ou `expo start` dans `apps/mobile`.
2. Typecheck : `cd apps/mobile && npx tsc --noEmit -p .` → **doit être vert**.
3. **Device réel branché** (le bug T2 ne se voit que là) :
   - `adb devices` (confirmer 1 device).
   - Naviguer vers l'écran modifié dans l'app.
   - `adb exec-out screencap -p > screen.png` puis lire l'image et **vérifier à l'œil** :
     texte non tronqué, alignements, densité, hiérarchie.
   - Tester les interactions concernées (tap chips, focus champ, scroll).
4. Si un glyphe est tronqué → c'est T2 : retirer le `padding` du chip répété, repasser en
   `height` + centrage + `marginHorizontal` sur le Text, retester.
5. Commit atomique. Passer au chantier suivant.

## Definition of Done (par chantier)

- [ ] Typecheck vert, zéro `any`.
- [ ] Vérifié à l'œil sur device (screenshot adb lu).
- [ ] Aucune valeur en dur (tout via `theme.ts`).
- [ ] Aucune fonctionnalité ajoutée/retirée ; aucun appel backend touché.
- [ ] Commit atomique `refactor(mobile/<scope>): …` poussé.
