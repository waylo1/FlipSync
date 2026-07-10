# FlipSync — Refonte des offres de publication (plan d'exécution)

> **Rôle exécutant (Sonnet).** Tu fais évoluer le **positionnement et la tarification** des
> trois offres. Tu n'ajoutes **aucune** fonctionnalité, aucune IA, aucun endpoint. Tu ne
> touches ni à la machine à états, ni au wallet, ni aux connecteurs marketplace. Tu adaptes
> prix, copie et présentation, et tu déplaces le **choix de l'offre** au moment du paiement.
> Chaque chantier = un commit atomique, testé, vérifié sur device, puis STOP.

Ce document est la référence. En cas de doute : la plus simple + la plus honnête.

---

## 0. Décisions actées (par Maxime)

1. **Trois offres, paiement par annonce, aucun abonnement particulier.** Prix : `0,99 € / 1,99 € / 2,99 €`.
2. **Cartes minimalistes.** Chaque carte affiche uniquement : **nom + prix + phrase d'autonomie + une ligne de soutien.** Aucune liste de fonctions, aucun « Bientôt », aucune promesse technique. Les cartes vendent un **niveau d'autonomie**, pas des fonctions inexistantes.
3. **Renommage du 1ᵉʳ palier : « Simple » → « Essentiel ».** (Libellé d'affichage seulement — l'enum Prisma reste `SIMPLE`, aucune migration.)
4. **Photos totalement découplées du palier.** 1 photo minimum pour tous ; autant de photos qu'on veut ; l'IA exploite ce qui existe. Le palier ne restreint jamais la capture.
5. **La différence entre offres = uniquement le niveau d'assistance IA** (aujourd'hui : positionnement ; les capacités réelles viendront plus tard).

### Décision d'implémentation recommandée (à confirmer par Maxime avant exécution)

Comme le palier ne pilote plus la capture ni l'IA, **le choix de l'offre n'a plus rien à faire sur l'écran caméra.** Il est déplacé au **moment du paiement** (écran `validate.tsx`), présenté en **3 cartes premium**, juste après que l'utilisateur a vu son annonce rédigée : *« Voici votre annonce. Comment voulez-vous la vendre ? »* C'est le moment naturel, honnête et premium pour choisir.

- **Variante minimale** (si Maxime préfère ne pas toucher au flux) : garder le choix sur l'écran caméra mais remplacer les 3 chips par 3 cartes. Déconseillé : 3 cartes sur une caméra live sont à l'étroit, et choisir le prix *avant* d'avoir vu l'annonce est moins pertinent.

Le plan ci-dessous décrit la **version recommandée** (choix au paiement).

---

## 1. Règles d'exécution (non négociables)

1. Un chantier = un commit atomique `feat|refactor|fix(scope): …`. Jamais grouper deux sujets.
2. Après chaque chantier : `npm run typecheck` **vert**, `npm run test` **vert** (`docker start flipsync-pg` — Postgres 5433 — avant les tests DB), puis vérification **sur device réel**.
3. Zéro valeur en dur : prix uniquement via `TIER_PRICING` (SSOT `packages/core`), styles uniquement via `src/theme.ts`.
4. **Honnêteté absolue** : n'afficher aucune fonction non disponible. Les cartes ne contiennent que nom / prix / phrase / ligne de soutien.
5. Conserver les composants existants (`Card`, `Button`, `ConditionChips`, tokens). Aucune duplication, aucun code mort laissé derrière.

---

## 2. Où vit le SSOT (déjà vérifié)

- **Prix** : `TIER_PRICING` dans `packages/core/src/types/listing.ts`. Le serveur débite via `authorize(userId, TIER_PRICING[tier])` (`packages/ai/src/listing-engine.ts`) ; le mobile affiche via `formatEur(TIER_PRICING[tier])`. **Changer cette table met à jour affichage ET facturation.**
- **Copie des offres** : `TIER_FEATURES` (même fichier).
- **Nombre de photos par palier** : `TIER_PHOTO_COUNT` (même fichier) — **à supprimer** (plus de différenciation par photos).
- **`cumulativeTierFeatures`** (même fichier) — **code mort** (utilisé nulle part dans l'app, seulement dans le test) — **à supprimer**.
- **Affichage de l'offre côté mobile** : `app/(tabs)/vendre.tsx` (chips), `app/validate.tsx` (ligne « Formule »). L'admin web n'a **aucune** référence.
- **Circulation du palier** : `vendre.tsx` (choix) → `useAnalysisQueue.enqueue(photos, tier)` → `AnalysisJob.tier` → `useListingSession.tier` → `validate.tsx` → `createListing(tier)` (prix). C'est ce chemin que le plan réoriente.

---

## 3. Copie & prix définitifs

### Prix (centimes) — `TIER_PRICING`

| Palier (enum) | Ancien | Nouveau | Δ |
|---|---|---|---|
| `SIMPLE` | 80 | **99** | +19 |
| `OPTIMIZED` | 250 | **199** | −51 |
| `PREMIUM` | 300 | **299** | −1 |

> ⚠️ Optimisé **baisse** (2,50 → 1,99) et Premium **baisse** (3,00 → 2,99) ; Essentiel **monte** (0,80 → 0,99). C'est voulu.

### Copie des 3 offres — nouveau `TIER_FEATURES`

Remplacer l'interface `TierFeature { label; adds }` par :

```
interface TierOffer { label: string; tagline: string; support: string }
```

| Enum | `label` | `tagline` | `support` |
|---|---|---|---|
| `SIMPLE` | **Essentiel** | Je publie. | Vous menez votre vente. |
| `OPTIMIZED` | **Optimisé** | L'IA m'aide. | Elle rédige votre annonce avec vous. |
| `PREMIUM` | **Premium** | L'IA vend pour moi. | Elle gère la vente à votre place. |

- Apostrophes typographiques `’` (cohérence avec le fichier existant).
- Le `support` d'Optimisé est **vrai aujourd'hui** (la rédaction IA existe). Les autres décrivent un **niveau d'autonomie**, pas une fonction — conforme à la décision 2. Ne jamais transformer `support` en liste de fonctions.

---

## 4. Chantiers (commits atomiques ordonnés)

### Commit 1 — SSOT : prix, renommage, copie des offres

**Fichier :** `packages/core/src/types/listing.ts` (+ `listing.test.ts`).

**Actions :**
1. `TIER_PRICING` → `99 / 199 / 299`.
2. Remplacer `TierFeature`/`TIER_FEATURES` par `TierOffer`/`TIER_FEATURES` (tableau §3 : `label`, `tagline`, `support`).
3. Supprimer `cumulativeTierFeatures` (code mort).
4. **Ne pas encore** supprimer `TIER_PHOTO_COUNT` (encore importé par `vendre.tsx`/`listing.store.ts` — retiré au commit 2).
5. `listing.test.ts` : retirer le bloc `cumulativeTierFeatures`. Ajouter un test simple : `TIER_PRICING` = 99/199/299, et chaque `TIER_FEATURES[t]` a `label`/`tagline`/`support` non vides. Garder le bloc `TIER_PHOTO_COUNT` (supprimé au commit 2).

**Effet immédiat :** nouveaux prix (affichage + débit) et nouveaux noms partout, sans rien casser (les écrans n'utilisent que `.label`, qui existe toujours).

**Vérif :** typecheck + tests verts.

**Commit :** `refactor(core): offres — prix 0,99/1,99/2,99, renommage Essentiel, copie autonomie`

---

### Commit 2 — Découpler les photos du palier + choix de l'offre au paiement

Chantier central : retire le palier de la capture, le pose au paiement.

**2a. `packages/core/src/types/listing.ts` (+ test)**
- Supprimer `TIER_PHOTO_COUNT`.
- `listing.test.ts` : retirer le bloc `TIER_PHOTO_COUNT`.

**2b. `app/(tabs)/vendre.tsx` — capture pure**
- Supprimer l'état `tier`, `styles.tierWrap` + les chips de palier (`TIERS.map`), et les imports devenus inutiles (`TIER_FEATURES`, `TIER_PHOTO_COUNT`, `TIER_PRICING`, `formatEur` si plus utilisé).
- Introduire `const MIN_PHOTOS = 1`. Remplacer toute occurrence de `requiredPhotos`/`TIER_PHOTO_COUNT[tier]` par `MIN_PHOTOS`.
- Jauge : seuil inutile (min = 1) — simplifier les textes :
  - 0 photo → « Photographiez votre objet sous tous les angles »
  - ≥ 1 photo → « Prêt — ajoutez des photos ou lancez la rédaction »
- Bouton : `< MIN_PHOTOS` → « Ajoutez une photo » (désactivé) ; sinon → « Rédiger ».
- `startAnalysis` : `useAnalysisQueue.getState().enqueue(photos)` (sans `tier`).

**2c. `src/store/listing.store.ts` — l'IA n'a plus besoin du palier**
- `AnalysisJob` : retirer le champ `tier`.
- `enqueue(photos: SessionPhoto[])` : retirer le paramètre `tier`.
- `start()` : remplacer `photos.slice(0, TIER_PHOTO_COUNT[job.tier])` par `photos.slice(0, AI_PHOTO_CAP)` avec `const AI_PHOTO_CAP = 3` (borne le coût d'inférence, indépendant du palier). `retry` inchangé.
- `useListingSession` : retirer `tier` de l'état et de `setSession(draft, photos)`.
- **Garder** `PendingPublish.tier` (le prix se fige à `createListing`, au paiement).

**2d. `app/processing.tsx`**
- `setSession(draft, photos, tier)` → `setSession(draft, photos)`.

**2e. `app/validate.tsx` — choix de l'offre en 3 cartes, au paiement**
- Le palier n'arrive plus par la session. `const [tier, setTier] = useState<ListingTier>(ListingTier.OPTIMIZED)` (défaut Optimisé, le milieu ; **pas** Premium — pas de nudge vers le plus cher).
- Remplacer la ligne « ℹ️ Formule … verrouillée » (`styles.formuleInfo`) par un **bloc 3 cartes** titré sobrement, ex. « Comment voulez-vous la vendre ? », **au-dessus** du bouton de publication.
- Chaque carte (composant `Card` + tokens) : `label`, `formatEur(TIER_PRICING[t])`, `tagline` (mise en avant), `support` (discret). Sélection au tap (`accessibilityRole="radio"`, `accessibilityState={{ selected }}`, `radiogroup` sur le conteneur). Carte sélectionnée : bordure/fond accentué via tokens. **Carte Premium : accent visuel léger** (bordure `theme.gold` ou légère élévation) — **jamais** de badge, « Populaire », 🔥, « Promo ».
- Le bouton garde `formatEur(TIER_PRICING[tier])`, la confirmation `Alert` garde `TIER_PRICING[tier]` — fonctionnent avec l'état local.
- **Cas reprise (`resume !== null`)** : palier déjà figé (`pending.tier`). Ne pas afficher le sélecteur ; afficher une ligne discrète « Offre : {label} · {prix} » (non modifiable). Initialiser `tier` avec `pending.tier`.
- `createListing(tier)` utilise l'état local. Reste du flux inchangé.

**Vérif :** typecheck + tests verts ; sur device : 1 photo suffit ; l'annonce se rédige ; l'écran de validation montre 3 cartes premium, prix corrects ; sélection fluide ; confirmation affiche le bon prix.

**Commit :** `refactor(mobile): choix de l'offre au paiement en 3 cartes, photos découplées du palier`

---

### Commit 3 — Nettoyage des références résiduelles

1. `grep` global (hors `node_modules`, hors ce plan et docs) : `0,80`, `2,50`, `3,00`, `250`/`300` en contexte prix, `Simple` en libellé d'offre, `Optimisée` (ancienne orthographe), `TIER_PHOTO_COUNT`, `cumulativeTierFeatures`, `Formule`. Corriger/supprimer.
2. Vérifier qu'aucun test ne référence encore les constantes supprimées.
3. **Free tier** : conservé (3 annonces gratuites/mois = essai gratuit, **pas** un abonnement). Aucun changement.

**Commit :** `chore(mobile): retrait des références aux anciens tarifs et à la différenciation par photos`

> **Optionnel (à valider) :** la table « Modèle économique » de `CLAUDE.md` affiche encore 80/250/300 + une ligne « Gestion Active /mois » (abonnement jamais construit). Si Maxime le souhaite : mettre à jour (99/199/299, retrait de la ligne abonnement). Non bloquant.

---

## 5. Points de vigilance / risques

- **Tests de prix à mettre à jour.** Changer `TIER_PRICING` cassera les tests qui asservissent un coût précis. Candidats : `apps/api/src/listing.flow.db.test.ts`, `packages/wallet/src/wallet.service.db.test.ts`, `packages/ai/src/listing-engine.db.test.ts`. Lancer la suite, mettre à jour les montants attendus (99/199/299). **Ne jamais** neutraliser un test pour le faire passer.
- **Garde-fou lancement (produit, pas code).** Aujourd'hui les 3 paliers livrent le même service réel (rédaction IA + publication). Tant qu'Optimisé/Premium n'ont pas de différenciation réelle, **ne pas encaisser de vrais paiements Premium** : c'est du pré-positionnement (les connecteurs marketplace sont eux aussi en attente d'accès partenaires). À rappeler avant ouverture commerciale.
- **Coût d'inférence dev.** `AI_PHOTO_CAP = 3` peut envoyer 3 photos « froides » au modèle CPU (~70-90 s chacune) — c'est déjà le comportement Premium actuel, pas une régression. Prod GPU : cap relevable.
- **Reprise de publication.** Bien tester le cas `pending !== null` : offre figée, non modifiable, prix correct.

---

## 6. Vérification (obligatoire à chaque commit)

1. `docker start flipsync-pg` si tests DB.
2. `npm run typecheck` → vert.
3. `npm run test` → vert (montants à jour).
4. Device réel (`npx expo start --android` dans `apps/mobile`) :
   - Capture : 1 photo suffit ; plus de mention de palier sur la caméra.
   - Rédaction → validation : 3 cartes premium, prix `0,99 / 1,99 / 2,99`, Premium légèrement accentuée, sélection fluide, a11y (radiogroup).
   - Confirmation : prix affiché = offre choisie.
   - Coordonnées via `uiautomator dump` (jamais estimer depuis un screenshot redimensionné).
5. Commit atomique. STOP. Chantier suivant.

## 7. Definition of Done

- [ ] Prix 0,99 / 1,99 / 2,99 partout (affichage + débit), un seul SSOT.
- [ ] 3 cartes : nom + prix + phrase + 1 ligne. Zéro fonction listée, zéro « Bientôt ».
- [ ] « Essentiel » remplace « Simple » à l'affichage (enum inchangé).
- [ ] Capture : 1 photo min, aucune restriction par palier.
- [ ] Choix de l'offre au paiement (ou variante minimale si Maxime la préfère).
- [ ] Aucune référence aux anciens tarifs ni à un abonnement particulier.
- [ ] typecheck + tests verts, vérifié sur device, commits atomiques.
