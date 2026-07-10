# Commissaire-Priseur IA — Conception produit & plan de réalisation

> Document de conception. **Aucun code ici.** Sonnet exécutera écran par écran à partir de la §10.
> Mode : Senior Product Engineer + UX Designer + Product Strategist.
> Règle qui gouverne tout le document : *chaque décision est justifiée par la valeur utilisateur.
> Tout ce qui ne crée pas de valeur claire, ou complexifie l'expérience, est écarté et marqué « ÉCARTÉ ».*

---

## 0. La promesse, en une phrase

**« Vous fixez votre prix. L'IA tient la vente. Vous donnez le coup de marteau. »**

Ce n'est pas un générateur d'annonce. Ce n'est pas un chatbot. C'est un **mandat de vente** confié à un
commissaire-priseur : il conduit la vente à votre place, dans les limites que vous avez fixées, et ne
revient vers vous que pour ce qui compte vraiment.

La métaphore du commissaire-priseur porte tout le produit et doit rester cohérente partout :

| Le métier | Dans FlipSync |
| --- | --- |
| On lui confie un **mandat** | L'écran de configuration produit un *Mandat de vente* |
| Il a un **prix de réserve** | Le *prix mini* — jamais franchi, jamais négociable |
| Il **conduit la vente** seul | L'IA répond, filtre, négocie dans la bande autorisée |
| Il en **réfère au propriétaire** hors mandat | « Validation requise » |
| Il **adjuge** (coup de marteau) | La vente finale = un geste humain, par défaut |
| Il **rend compte** | L'écran *Fin de mission* |

Pourquoi ce mot, *mandat*, plutôt que « paramètres » ou « configuration » : un mandat se **confie**, il
engage, il rassure. « Je configure un chatbot » est une corvée ; « je confie un mandat » est une
délégation. Le vocabulaire fait 50 % du sentiment premium recherché.

---

## 1. Prérequis technique déterminant (à lire avant tout)

L'IA ne peut « négocier » que s'il existe un **flux de messages acheteur → vendeur** qu'elle peut lire et
auquel elle peut répondre.

**État actuel du code :** FlipSync publie l'annonce sur des plateformes externes (Leboncoin/Vinted via
`packages/marketplace`). Le cycle de vie s'arrête à `PUBLISHED`. Il n'existe aujourd'hui **aucune
messagerie, aucune entité acheteur, aucune offre** côté FlipSync.

**Conséquence produit :** la valeur Premium est *entièrement conditionnée* par ce canal. Deux façons de
l'obtenir (hors périmètre de ce chantier — décision business à trancher séparément) :

- **A.** Accès partenaire à la messagerie des plateformes (API). Dépend d'accords ; le connecteur
  Leboncoin est encore un stub `TODO(partenaire)`.
- **B.** FlipSync héberge la conversation (l'acheteur passe par un lien FlipSync). Pivot plus lourd.

**Décision de conception :** on découpe le chantier pour que **toute la partie mandat + supervision + UX
soit livrable et testable immédiatement**, indépendamment du canal. Le canal de messages est isolé
derrière **une seule frontière** (§9, « Adaptateur de canal ») que l'on branchera le jour venu. Tant que
le canal réel n'est pas là, un **canal simulé** (messages de démonstration injectables) permet de
développer, tester et faire la démo de bout en bout — sans jamais mentir à l'utilisateur en production.

> Règle de sécurité produit non négociable, déjà actée au chantier précédent :
> **ne jamais encaisser un paiement Premium réel tant que la négociation réelle n'est pas branchée.**
> Le palier reste désactivable (feature flag, §10.0).

---

## 2. Ce que l'IA peut faire — et ne fera jamais

C'est le cœur de la confiance. À rendre visible dans le produit (écran Mandat, §5.3), pas enterré dans des
CGU.

### 2.1 L'IA agit seule (dans les limites du mandat)
- Répondre aux **questions factuelles** déjà présentes dans l'annonce (état, dimensions, disponibilité,
  mode de remise).
- **Filtrer** : ignorer spam, hors-sujet, messages non sérieux (« encore dispo ? » sans suite), tentatives
  d'arnaque connues.
- **Négocier** dans la bande `prix affiché → prix mini` : accepter une offre ≥ prix mini selon la posture,
  refuser poliment sous le prix mini, faire une contre-proposition.
- **Relancer une fois** un acheteur tiède resté sans réponse (jamais de harcèlement : une relance, puis
  silence).

### 2.2 L'IA ne le fait JAMAIS (garde-fous absolus, non désactivables)
- Descendre **sous le prix mini**. Jamais. Sous aucune formulation.
- Communiquer vos **coordonnées personnelles** (téléphone, adresse, email).
- Accepter un **paiement ou une remise hors du circuit sécurisé** (virement « ami/famille », chèque à
  l'avance, lien de paiement tiers, mandat cash — arnaques classiques).
- **Engager, transférer ou percevoir de l'argent** en votre nom.
- Promettre ce qui **n'est pas dans l'annonce** (garantie, essai, réparation, envoi non prévu).
- Accepter un **mode de livraison non autorisé** par le mandat.

### 2.3 L'IA doit vous demander (validation humaine obligatoire)
- **Le coup de marteau** — l'acceptation finale qui engage la vente. *Par défaut, toujours humain.*
  (Réglable, §4.4.)
- Tout **cas hors mandat** si vous avez choisi « Me demander » pour les cas complexes.
- Un acheteur qui **insiste** pour sortir du circuit sécurisé (on ne coupe pas : on vous alerte, car c'est
  parfois un acheteur maladroit mais réel).
- Une offre qui **atteint exactement le prix mini** quand la posture ne l'accepte pas d'office.

> Décision UX forte — *pourquoi le coup de marteau reste humain par défaut.* On délègue la **corvée**
> (répondre 20 fois, filtrer, marchander), pas la **décision**. « L'IA a tout fait, il ne vous reste que le
> oui final » est à la fois le plus rassurant et le plus premium. Les utilisateurs qui veulent le zéro-clic
> peuvent l'activer explicitement (§4.4) — mais ce n'est pas le défaut, parce que la confiance se gagne
> avant de se déléguer totalement.

---

## 3. Les quatre postures (écran « Configurez votre IA »)

Une posture = un préréglage nommé sur **deux cadrans** internes (invisibles pour l'utilisateur — il ne voit
que les quatre noms) :

- **Cadran A — concession de prix** : combien l'IA lâche entre prix affiché et prix mini.
- **Cadran B — autonomie / prudence** : combien l'IA ose trancher seule vs vous référer.

| Posture | Concession | Autonomie | Promesse en une ligne | Ce que ça change concrètement |
| --- | --- | --- | --- | --- |
| ⚡ **Vente rapide** | forte | haute | « Vendu vite, sans prise de tête. » | Accepte dès qu'on approche du prix mini, concède tôt, vise conclure sous 48 h. |
| ⚖️ **Équilibré** *(défaut)* | moyenne | moyenne | « Le bon compromis prix / rapidité. » | Négocie sans brader, tient quelques échanges, cède raisonnablement. |
| 💎 **Meilleur prix** | faible | moyenne | « On vise le meilleur prix, patiemment. » | Tient le prix affiché, concède peu et tard, laisse filer les pressés. |
| 🛡️ **Très prudent** | faible-moy. | basse | « Zéro risque, vous validez plus souvent. » | Filtre fort, ne s'engage jamais seul sur un cas ambigu, vous réfère largement. |

Chaque carte affiche **le nom, l'emoji, la promesse, et une ligne de soutien** — jamais une liste de
réglages. La posture est un **point de départ** ; « Personnaliser » (§4) permet d'ajuster.

> Réconciliation des axes — *pourquoi ces quatre-là cohabitent.* Rapide / Équilibré / Meilleur prix vivent
> sur le cadran A (prix). Très prudent vit surtout sur le cadran B (risque). Les mêmes deux cadrans
> décrivent les quatre : le modèle reste simple (2 nombres) et l'utilisateur ne voit que 4 mots. Aucun
> curseur exposé à cet écran — la simplicité radicale d'abord.

---

## 4. « Personnaliser » — l'assistant (4 questions, une par vue)

Bouton discret sous les quatre postures : **« Personnaliser »**. Il ouvre une feuille plein écran, **une
question à la fois**, barre de progression fine (4 points). On ne demande QUE ce qui a de la valeur.

### 4.1 Objectif *(pré-rempli par la posture — 1 tap pour confirmer)*
Trois choix : *Vendre vite · Équilibre · Meilleur prix*. Redit en clair l'intention de la posture ; on peut
la corriger ici sans revenir en arrière. **Pourquoi le garder alors qu'il double la posture :** il fait le
lien mental entre « le nom que j'ai choisi » et « ce que l'IA va viser » — c'est la première ligne du futur
Mandat. Coût : un tap. Valeur : compréhension. Gardé.

### 4.2 Prix minimum accepté *(le seul champ vraiment critique)*
Question : **« En dessous de quel prix ne jamais descendre ? »**
Pré-rempli avec le *prix plancher* déjà estimé par l'IA à l'écran de validation (`prixPlancher`). Champ
monétaire, gros, au centre. Sous le champ, un repère vivant :
`Prix affiché 820 € · Marge de négociation : −5 %` (la marge est **dérivée**, jamais saisie).

> Décision — *on fusionne « prix mini » et « négociation maximale autorisée ».* Ce sont la **même
> contrainte** exprimée deux fois : la négociation maximale, c'est précisément le prix mini. Demander les
> deux, c'est demander deux fois la même chose et risquer l'incohérence. On saisit **un prix concret**
> (plus intuitif qu'un %), on **affiche** le % dérivé pour rassurer. ÉCARTÉ : le champ « négociation max
> % » séparé. ÉCARTÉ : un « prix coup de cœur / acceptation immédiate » (gadget, ajoute une 3ᵉ notion de
> prix sans valeur nette).

### 4.3 Préférences de livraison
Trois choix, cartes : *Main propre · Envoi · Les deux*. Détermine ce que l'IA a le droit d'accepter. Si
« Envoi » ou « Les deux », une ligne : *« L'IA propose l'envoi via le circuit sécurisé de la plateforme. »*
(rappel du garde-fou 2.2).

### 4.4 Que faire quand un cas dépasse les règles ?
Trois choix : *Me demander (défaut) · Refuser · Continuer la discussion*.
- **Me demander** → « Validation requise » (le plus sûr, défaut).
- **Refuser** → l'IA décline poliment et clôt.
- **Continuer la discussion** → l'IA maintient le contact et vous fait un résumé, sans engager.

**Réglage avancé, sous un repli discret « Options » (fermé par défaut) :**
un seul interrupteur — **« Adjuger sans me demander au-dessus du prix mini »** (OFF par défaut).
ON = zéro-clic, l'IA conclut seule dès que l'offre respecte le prix mini. On l'enterre volontairement : la
majorité doit garder le coup de marteau. ÉCARTÉ : tout autre réglage fin ici (créneaux horaires, ton de
voix, etc. — gadgets).

> L'assistant complet = **4 taps** dans le cas nominal (posture déjà choisie, prix pré-rempli). C'est
> l'étalon « Apple » : le chemin le plus court qui laisse quand même le contrôle.

---

## 5. Les six écrans

Périmètre volontairement resserré à **six écrans** qui couvrent tout le cycle de vie. Chaque écran ci-dessous
donne : objectif · placement dans le flux · wireframe textuel · composants (réutilisés du design system) ·
textes exacts · hiérarchie · états · animations · erreurs · accessibilité.

Design system à réutiliser **tel quel** (aucune nouvelle primitive) :
`Card`, `Tappable`, `Button`, `Field`, `AmountText`, `Badge`, `StackHeader`, `ScreenHeader`, `EmptyState`,
`FadeInUp`, `Skeleton`. Tokens : `theme.*`, `space[1..8]`, `radius`, `font`, `line`, `shadow`, `motion`.
Argent : centimes Int + `formatEur` / `AmountText`. Accent Premium = `theme.goldDark` (liseré), action =
`theme.terracotta`, succès = `theme.bouteille`, attente/vigilance = `theme.moutarde`.

---

### 5.1 — Écran S1 · « Configurez votre IA » (choix de posture)

**Objectif :** en 5 secondes, choisir comment l'IA doit vendre. Premier contact avec la délégation.
**Placement :** juste après avoir tapé *« Valider et publier — 2,99 € »* sur l'écran de validation (Premium
uniquement). La publication n'est **pas** encore faite : on construit le mandat *avant* de lancer la vente.

```
┌─────────────────────────────────────┐
│ ‹ Retour            Configurez l'IA  │   StackHeader
│                                      │
│  Comment l'IA doit-elle vendre ?     │   font.heading, tracking.heading
│  Vous gardez le contrôle. Vous       │   font.body, theme.muted
│  validez la vente finale.            │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ ⚡  Vente rapide                │  │   Card + Tappable (radio)
│  │ Vendu vite, sans prise de tête │  │   titre font.lead 700 / soutien caption muted
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ ⚖️  Équilibré          ● choisi │  │   carte active : liseré terracotta 2px + fond terracottaSoft
│  │ Le bon compromis prix/rapidité │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ 💎  Meilleur prix               │  │
│  │ On vise le meilleur prix        │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ 🛡️  Très prudent                │  │
│  │ Zéro risque, vous validez plus  │  │
│  └────────────────────────────────┘  │
│                                      │
│           Personnaliser              │   Button variant="ghost", theme.goldDark
│  ────────────────────────────────    │
│  [ Continuer ]                       │   Button plein terracotta, sticky bas
└─────────────────────────────────────┘
```

- **Composants :** `StackHeader`, quatre `Tappable`+`Card` (pattern radio identique à l'écran offres),
  `Button` ghost « Personnaliser », `Button` plein « Continuer » collé en bas.
- **Textes exacts :** titre `Comment l'IA doit-elle vendre ?` · sous-titre
  `Vous gardez le contrôle. Vous validez la vente finale.` · postures = table §3 · ghost `Personnaliser` ·
  CTA `Continuer`.
- **Hiérarchie :** le titre domine ; les 4 cartes de poids égal (aucune n'est « poussée » — pas de
  Best-Seller, cf. philosophie) sauf l'état *choisi* ; « Personnaliser » discret ; « Continuer » = seul
  élément terracotta.
- **États :** défaut = ⚖️ Équilibré présélectionné. Sélection = liseré `theme.terracotta` 2 px + fond
  `terracottaSoft`. « Continuer » toujours actif (une posture est toujours choisie).
- **Animations :** sélection = ressort d'échelle du `Tappable` (déjà en place, `motion.ease.standard`).
  Entrée de liste = `FadeInUp` léger, décalé. Rien de plus.
- **Erreurs :** aucune saisie ici → aucune erreur possible. C'est voulu.
- **Accessibilité :** `accessibilityRole="radiogroup"` sur la liste, `radio` + `accessibilityState.selected`
  sur chaque carte, label = `⟨nom⟩, ⟨promesse⟩`. « Continuer » libellé complet.

---

### 5.2 — Écran S2 · Assistant « Personnaliser » (feuille, une question par vue)

**Objectif :** affiner sans jamais submerger. 4 vues, 4 questions (§4).
**Placement :** ouvert depuis « Personnaliser » (S1). À la fin, retombe sur S3 (Mandat).

```
┌─────────────────────────────────────┐
│ ✕                         ● ● ○ ○     │   fermer + progression 4 points (goldDark plein)
│                                      │
│  En dessous de quel prix             │   font.heading
│  ne jamais descendre ?               │
│                                      │
│            ┌───────────┐             │
│            │   780 €    │             │   Field monétaire, gros (font.display), centré
│            └───────────┘             │
│   Prix affiché 820 €  ·  −5 %        │   caption muted, marge DÉRIVÉE
│                                      │
│  ────────────────────────────────    │
│  [ Continuer ]                       │   plein terracotta
└─────────────────────────────────────┘
```

- **Les 4 vues :** (1) Objectif — 3 cartes ; (2) Prix mini — champ ci-dessus ; (3) Livraison — 3 cartes ;
  (4) Cas complexes — 3 cartes + repli « Options » (interrupteur §4.4).
- **Composants :** en-tête custom (✕ + points de progression), `Field` (prix), `Tappable`+`Card` (choix),
  `Button` « Continuer » / dernière vue « Voir mon mandat ».
- **Textes exacts :** titres = §4.1–4.4 · dernier CTA `Voir mon mandat`.
- **Hiérarchie :** une question = un écran. La question domine ; la réponse est l'unique zone active ; le
  CTA en bas. Zéro distraction.
- **États :** chaque réponse pré-remplie d'une valeur par défaut sensée (objectif←posture, prix←`prixPlancher`,
  livraison←*Les deux*, cas←*Me demander*, interrupteur←OFF) → l'utilisateur peut tout accepter en tapant
  « Continuer », c'est le chemin rapide.
- **Animations :** transition entre vues = glissement horizontal doux (`motion.dur.base`,
  `ease.standard`). Points de progression se remplissent en `goldDark`.
- **Erreurs :** seule la vue Prix peut faillir. Règles : prix mini **≤ prix affiché** et **> 0**. Si
  franchi → message inline sous le champ, `theme.brique` : `Le prix mini doit être inférieur au prix affiché.`
  « Continuer » désactivé tant que non résolu. Aucune autre validation.
- **Accessibilité :** points de progression = `accessibilityLabel="Étape 2 sur 4"`. Champ prix =
  `keyboardType="numeric"`, label explicite. Repli « Options » = `accessibilityRole="button"` +
  `expanded` state.

---

### 5.3 — Écran S3 · « Votre mandat de vente » (résumé de la stratégie IA)

**Objectif :** le moment de bascule émotionnelle — *« je confie vraiment ma vente ».* Rendre le mandat
lisible, sûr, et signé d'un geste.
**Placement :** après S1 (si pas de personnalisation) ou après S2. Confirme → publie l'annonce + démarre la
mission.

```
┌─────────────────────────────────────┐
│ ‹ Retour              Votre mandat   │
│                                      │
│      🪧                               │   emblème (emoji panneau/marteau), centré
│  Votre commissaire-priseur           │   font.heading, centré
│  IA est prêt.                        │
│                                      │
│  ┌────────────────────────────────┐  │   Card unique, "papier de mandat"
│  │ Objectif        Meilleur prix  │  │   lignes label(muted) / valeur(ink 600)
│  │ Prix mini             780 €    │  │   valeur prix = AmountText
│  │ Négociation           −5 %     │  │
│  │ Livraison             Envoi    │  │
│  │ Cas complexes    Me demander   │  │
│  └────────────────────────────────┘  │
│                                      │
│  L'IA ne descendra jamais sous       │   bloc "garanties", theme.bouteille + ✓
│  votre prix mini et ne partagera     │   font.small, 3 puces max
│  jamais vos coordonnées.             │
│  Vous validez la vente finale.       │
│                                      │
│  ────────────────────────────────    │
│  [ Confirmer le mandat ]             │   plein terracotta
│   Modifier                           │   ghost, retour S1
└─────────────────────────────────────┘
```

- **Composants :** `ScreenHeader`/`StackHeader`, une `Card` récap (lignes label/valeur), un bloc
  « garanties » (3 puces `theme.bouteille` avec ✓), `Button` plein « Confirmer le mandat », `Button` ghost
  « Modifier ».
- **Textes exacts :** titre `Votre commissaire-priseur IA est prêt.` · lignes récap =
  `Objectif / Prix mini / Négociation / Livraison / Cas complexes` · garanties (exactement 3) :
  `L'IA ne descend jamais sous votre prix mini.` ·
  `Vos coordonnées restent privées.` ·
  `Vous validez la vente finale.` · CTA `Confirmer le mandat` · ghost `Modifier`.
- **Hiérarchie :** emblème + titre (émotion) → carte mandat (les faits) → garanties (la sécurité) → CTA
  (l'engagement). C'est une **descente logique** vers la signature.
- **États :** si l'interrupteur « adjuger sans me demander » est ON, la ligne `Cas complexes` est suivie
  d'une pastille discrète `Adjuge seule au-dessus du prix mini` (`Badge`, `theme.moutarde`) — l'utilisateur
  doit *voir* qu'il a levé le coup de marteau humain.
- **Animations :** apparition de la carte en `FadeInUp`, puis les 3 garanties se cochent une à une
  (`motion.dur.fast`, décalées) — micro-cérémonie de confiance. À « Confirmer » : le bouton passe en
  chargement, puis transition vers S4.
- **Erreurs :** la confirmation déclenche publication + création de mission. Si la **publication échoue**
  (réseau/plateforme) → on reste sur S3, `ErrorBanner` en haut, message humain
  `La mise en vente n'a pas abouti — rien n'est débité, réessayez.` (aligné sur la convention « échec =
  remboursement/rien débité » du reste de l'app). Le mandat saisi est conservé.
- **Accessibilité :** carte récap = liste sémantique (chaque ligne `label: valeur` en un seul
  `accessibilityLabel`). Garanties = `accessibilityRole="text"`. CTA libellé complet.

---

### 5.4 — Écran S4 · « Mission » (tableau de bord vivant)

**Objectif :** l'écran où « je délègue » se vit au quotidien. En un coup d'œil : *où en est ma vente, et
est-ce qu'on attend quelque chose de moi ?* Doit être **calme** : si rien ne requiert le vendeur, l'écran
respire.
**Placement :** remplace l'écran `listing-view` pour une annonce Premium en mission. Accessible depuis
l'accueil (la tuile de l'annonce).

```
┌─────────────────────────────────────┐
│ ‹                      Veste cuir ⋯  │   StackHeader (⋯ = suspendre/arrêter mission)
│                                      │
│  ┌────────────────────────────────┐  │   BANDEAU D'ÉTAT (change selon phase)
│  │ 🤖  Négociation en cours        │  │   veille : faience / attente : moutarde / vendu : bouteille
│  │ 2 acheteurs · meilleure offre  │  │
│  │ 790 €                          │  │
│  └────────────────────────────────┘  │
│                                      │
│  ── EN ATTENTE DE VOUS ──────────    │   n'apparaît QUE s'il y a une validation
│  ┌────────────────────────────────┐  │
│  │ ⚠️ Offre à 780 € — au prix mini │  │   Card moutarde, tap → S5
│  │ Répondre ›                      │  │
│  └────────────────────────────────┘  │
│                                      │
│  ── ACTIVITÉ ────────────────────    │   timeline, la plus récente en haut
│  🤖 Contre-proposition à 800 €  ·2min│   ligne : icône · texte · temps relatif
│  ✅ Offre intéressante · 790 €  ·14min│
│  🤖 Question répondue (taille) ·1 h  │
│  📢 Mise en vente               ·2 h  │
│                                      │
│  ────────────────────────────────    │
│  Objectif Meilleur prix · mini 780 € │   rappel discret du mandat, ghost → S3 lecture seule
└─────────────────────────────────────┘
```

- **Composants :** `StackHeader` (+ menu ⋯), **bandeau d'état** (`Card` colorée selon phase), section
  conditionnelle « En attente de vous » (`Card` `theme.moutarde` + `Tappable`), **timeline** d'activité
  (lignes `icône · texte · temps relatif`), pied de page « rappel mandat » (`Tappable` ghost).
  `EmptyState` si aucune activité encore (« L'IA veille. Dès qu'un acheteur se manifeste, ça apparaît
  ici. »). `Skeleton` au chargement.
- **Textes exacts (bandeau selon phase) :**
  `En vente · l'IA veille` (faience clair) ·
  `Négociation en cours` + `N acheteurs · meilleure offre X €` (faience) ·
  `En attente de vous` (moutarde) ·
  `Vendu` + `à X €` (bouteille).
- **Hiérarchie :** 1) ce qu'on attend de moi (moutarde, tout en haut si présent) ; 2) l'état global ; 3)
  l'historique ; 4) le mandat (rappel discret). **Si rien n'est en attente, la section moutarde
  disparaît** — l'écran doit être serein quand l'IA gère seule.
- **États :** `En vente (veille)` · `Négociation active` · `En attente de vous` (≥1 validation) ·
  `Vendu` · `Suspendue` (menu ⋯) · `Expirée`. Le menu ⋯ = `Suspendre la mission` /
  `Arrêter la mission` (avec confirmation ; arrêter = l'IA cesse, l'annonce reste en ligne, vente
  redevient manuelle).
- **Animations :** nouvelle ligne de timeline = `FadeInUp` en tête. Passage en « En attente de vous » = la
  carte moutarde entre par le haut + halo doux une fois. Passage à « Vendu » = le bandeau vire `bouteille`
  avec une coche animée. Jamais d'animation gratuite ailleurs.
- **Erreurs :** perte de connexion = bandeau discret `Mise à jour impossible — réessai automatique`
  (`theme.muted`, pas alarmant : l'IA tourne côté serveur, pas sur le téléphone). Échec de chargement =
  `ErrorBanner` + bouton Réessayer.
- **Accessibilité :** bandeau d'état = `accessibilityLiveRegion="polite"` (les changements d'état sont
  annoncés). Chaque ligne de timeline = un `accessibilityLabel` complet `⟨événement⟩, il y a ⟨temps⟩`.
  Carte « en attente » = `role="button"`, label `Validation requise : ⟨résumé⟩`.

---

### 5.5 — Écran S5 · « Validation requise » (le coup de marteau)

**Objectif :** l'humain tranche en un geste, avec tout le contexte, sans avoir à lire l'historique. Le
moment le plus important du produit.
**Placement :** feuille modale (`shadow.sheet`) ouverte depuis la carte moutarde de S4 ou depuis une
notification.

```
┌─────────────────────────────────────┐
│ ✕                                    │
│                                      │
│  L'IA a une offre pour vous          │   font.heading
│                                      │
│  ┌────────────────────────────────┐  │   Card offre
│  │        790 €                   │  │   AmountText font.display, centré
│  │  Offre de « Julien M. »        │  │   nom acheteur (public plateforme)
│  │  ✓ Compte vérifié · Envoi      │  │   signaux publics plateforme, Badge bouteille
│  └────────────────────────────────┘  │
│                                      │
│  Ce que l'IA a négocié :             │   résumé IA, 2–3 lignes MAX, font.small muted
│  « Parti de 750 €, remonté à 790 €.  │
│   Au-dessus de votre prix mini. »    │
│                                      │
│  ────────────────────────────────    │
│  [ Accepter — vendre 790 € ]         │   plein bouteille (c'est une bonne nouvelle)
│  [ Laisser l'IA continuer ]          │   ghost terracotta
│   Refuser cette offre                │   texte brique discret
└─────────────────────────────────────┘
```

- **Composants :** feuille modale, `Card` offre (`AmountText` + `Badge` signaux publics), bloc « résumé IA »
  (texte court), 3 actions hiérarchisées : `Button` plein `theme.bouteille` (accepter), `Button` ghost
  (laisser continuer), lien texte `theme.brique` (refuser).
- **Textes exacts :** titre `L'IA a une offre pour vous` · action haute `Accepter — vendre ⟨X⟩ €` ·
  action moyenne `Laisser l'IA continuer` · action basse `Refuser cette offre`. Cas « alerte sécurité »
  (acheteur hors circuit) : titre `Un acheteur sort du circuit sécurisé` + corps expliquant le risque,
  actions `Bloquer (recommandé)` / `Voir le message`.
- **Hiérarchie :** le **montant** domine (c'est la décision) → qui + signaux de confiance → ce que l'IA a
  fait (rassure sur le travail délégué) → actions, la positive en premier et en `bouteille`.
- **États :** offre standard (ci-dessus) · offre **au prix mini exact** (bandeau moutarde `C'est votre
  plancher — l'IA n'ira pas plus haut`) · **alerte sécurité** (variante brique) · **cas complexe hors
  règles** (« L'IA ne sait pas trancher : ⟨question⟩ » + Répondre moi-même / Refuser).
- **Animations :** entrée de feuille par le bas (`ease.decelerate`). À « Accepter » → coche animée
  `bouteille` puis fermeture + S4 bascule en « Vendu ». Aucune animation sur les actions destructrices.
- **Erreurs :** si l'acheteur retire son offre pendant que la feuille est ouverte → la feuille se met à
  jour en douceur : `Cette offre a été retirée.` + seule action `Fermer`. On ne laisse jamais accepter une
  offre morte.
- **Accessibilité :** feuille = `accessibilityViewIsModal`. Montant lu en entier. Ordre de focus = titre →
  offre → résumé → action positive. Actions destructrices demandent confirmation.

---

### 5.6 — Écran S6 · « Mission terminée » (la récompense premium)

**Objectif :** matérialiser la valeur reçue — *« l'IA a vendu à ma place »* — et donner envie de
recommencer (donc de repayer Premium).
**Placement :** après acceptation (S5) ou vente conclue par l'IA en mode zéro-clic. Aussi consultable
depuis l'historique.

```
┌─────────────────────────────────────┐
│                                      │
│            🎉                         │   centré, discret (pas de confettis criards)
│        Vendu à 790 €                 │   font.display, bouteille
│                                      │
│  Votre commissaire-priseur IA a      │   font.body, centré
│  géré la vente pour vous.            │
│                                      │
│  ┌────────────────────────────────┐  │   Card "compte-rendu"
│  │ 💬 12 messages traités          │  │   les chiffres du temps gagné
│  │ 🤖 3 offres négociées           │  │
│  │ ⏱️ Vendu en 1 j 4 h             │  │
│  │ 📈 +40 € vs première offre      │  │   valeur créée, si applicable
│  └────────────────────────────────┘  │
│                                      │
│  ── PROCHAINE ÉTAPE ─────────────    │
│  Finalisez l'envoi via la plateforme │   la seule action réelle restante côté vendeur
│  [ Voir les instructions ]           │
│                                      │
│  ────────────────────────────────    │
│  Vendre un autre objet               │   ghost → caméra
└─────────────────────────────────────┘
```

- **Composants :** en-tête célébration sobre, `Card` compte-rendu (4 stats max), section « prochaine
  étape » (l'envoi/remise reste au vendeur), `Button` ghost « Vendre un autre objet ».
- **Textes exacts :** titre `Vendu à ⟨X⟩ €` · sous-titre
  `Votre commissaire-priseur IA a géré la vente pour vous.` · stats (adaptées aux données réelles) ·
  section `Finalisez l'envoi via la plateforme` · CTA final `Vendre un autre objet`.
- **Hiérarchie :** résultat (le prix) → attribution à l'IA (le sens) → preuves du temps gagné → l'unique
  chose qui reste à faire → rebond.
- **États :** vendu par validation humaine · vendu en zéro-clic (mention `L'IA a adjugé selon votre
  mandat`) · mission **arrêtée sans vente** (variante neutre : `Mission terminée` + `Aucune vente conclue`,
  ton factuel, jamais culpabilisant).
- **Animations :** 🎉 apparaît en `FadeInUp` + léger ressort, une fois. Stats se posent en cascade douce.
  Sobriété = premium ; pas de pluie de confettis.
- **Erreurs :** aucune action bloquante ici. « Voir les instructions » ouvre les infos plateforme ;
  indisponibles → message neutre.
- **Accessibilité :** titre annoncé en premier (`liveRegion`), stats en liste, CTA libellé complet.

---

## 6. Cycle de vie complet (machine à états de la Mission)

```
        (Premium choisi à l'écran validation)
                    │
              [ S1 posture ] ──► [ S2 personnaliser ]* ──► [ S3 mandat ]
                                                                │ Confirmer
                                                                ▼
   BROUILLON_MANDAT ──────────────────────────────────► EN_VENTE (l'IA veille)
                                                                │
                          ┌─────────────────────────────────────┤ message acheteur
                          ▼                                     ▼
                 NEGOCIATION_ACTIVE ◄──────────────► EN_ATTENTE_VALIDATION (S5)
                          │  accord ≥ prix mini            │ (cas hors mandat / coup de marteau)
                          │                                │
                          └───────────────┬────────────────┘
                                          ▼ vente confirmée (humain ou zéro-clic)
                                       VENDU (S6)
                                          │
                                          ▼
                                   MISSION_TERMINEE
     ┌───────────────── transitions transverses ─────────────────┐
     │ SUSPENDUE  (menu ⋯, réversible)                            │
     │ ARRETEE    (menu ⋯, l'IA cesse, vente redevient manuelle)  │
     │ EXPIREE    (délai plateforme atteint sans vente)           │
     └────────────────────────────────────────────────────────────┘
   * étape optionnelle
```

Étapes demandées ↔ états : **Création** = choix Premium ; **Configuration** = S1→S3 (`BROUILLON_MANDAT`) ;
**Mise en vente** = `EN_VENTE` ; **Négociation** = `NEGOCIATION_ACTIVE` ; **Validation** =
`EN_ATTENTE_VALIDATION` (S5) ; **Vente** = `VENDU` (S6) ; **Fin de mission** = `MISSION_TERMINEE`.

---

## 7. Notifications (push + centre d'activité)

Principe : **notifier ce qui crée de la valeur ou requiert une décision. Jamais de bavardage.** Une IA qui
« parle pour parler » détruit le premium. Regroupement anti-spam : au plus **une notification de
négociation par heure** par mission (l'activité fine reste dans la timeline S4).

| Événement | Push ? | Ton / couleur | Texte exact |
| --- | --- | --- | --- |
| ✅ Offre intéressante trouvée | Oui | bouteille | `Bonne nouvelle : offre à ⟨X⟩ € sur « ⟨objet⟩ ».` |
| 🤖 Négociation en cours | Non* | faience | *(timeline seulement, pas de push)* |
| ⚠️ Validation requise | Oui (prioritaire) | moutarde | `L'IA attend votre feu vert pour « ⟨objet⟩ ».` |
| 🛡️ Alerte sécurité | Oui (prioritaire) | brique | `Un acheteur tente de sortir du circuit sécurisé.` |
| 🎉 Accord trouvé / Vendu | Oui | bouteille | `Vendu ⟨X⟩ € ! L'IA a conclu « ⟨objet⟩ ».` |
| 📦 Vente terminée / à finaliser | Oui | bouteille | `Finalisez l'envoi de « ⟨objet⟩ ».` |
| ⏳ Mission expirée sans vente | Oui | muted | `La vente de « ⟨objet⟩ » a expiré. Relancer ?` |

\* « Négociation en cours » n'est **jamais** un push (§ anti-bavardage) : il vit uniquement dans la timeline
S4 et le bandeau d'état.

---

## 8. Règles métier — synthèse actionnable (source de vérité pour Sonnet)

Regroupe §2 sous forme exécutable. À implémenter comme **contrôles serveur**, pas comme suggestions au
modèle (un garde-fou ne se « demande » pas au LLM, il se **vérifie** en code).

- **R1 — Plancher dur.** Toute acceptation/contre-proposition < `prixMini` est rejetée par le code avant
  envoi. Non désactivable.
- **R2 — Confidentialité.** Tout message sortant est filtré : aucun numéro de téléphone, email, adresse,
  lien externe. Non désactivable.
- **R3 — Circuit sécurisé.** Détection de motifs d'arnaque (paiement hors plateforme, sur-paiement,
  transporteur imposé) → jamais accepté seul → `EN_ATTENTE_VALIDATION` + notif sécurité.
- **R4 — Coup de marteau.** L'acceptation finale exige `humanApproved = true`, **sauf** si
  `autoAdjugeAuDessusDuMini = true` (interrupteur §4.4) **et** offre ≥ `prixMini`.
- **R5 — Livraison.** N'accepter que les modes ∈ `preferencesLivraison`.
- **R6 — Cas hors mandat.** Route selon `casComplexes` : `ME_DEMANDER` → validation ; `REFUSER` → décline ;
  `CONTINUER` → maintient le contact, résume, n'engage pas.
- **R7 — Relance unique.** Au plus une relance par acheteur. Jamais de harcèlement.
- **R8 — Anti-spam notif.** Cf. §7.
- **R9 — Signaux de confiance = publics uniquement.** On affiche ce que la plateforme expose déjà (compte
  vérifié, ancienneté). **ÉCARTÉ :** tout système de réputation propriétaire (hors périmètre, hors
  promesse, coûteux).

---

## 9. Architecture produit (frontière, pas d'implémentation)

Une seule **source de vérité** pour le mandat, sur le modèle exact de `TIER_PRICING` /
`TIER_FEATURES` (dans `packages/core/src/types/`) :

- `SellMandate` : `{ objectif, prixAffiche, prixMini, preferencesLivraison, casComplexes,
  autoAdjugeAuDessusDuMini }` — centimes Int pour tout montant.
- `SellPosture` : enum des 4 postures → préréglage `(concession, autonomie)`.
- `MissionStatus` : enum §6 (à ajouter au `schema.prisma`, donc régénéré dans `enums.ts`).

**Adaptateur de canal** (la frontière du §1) : une interface unique
`NegotiationChannel { pull(): messages ; reply(msg) ; propose(price) ; accept() ; reject() }`, avec **deux
implémentations** — `SimulatedChannel` (démo/dev/tests, messages injectables) et, plus tard, le connecteur
réel (partenaire plateforme). **Tout le reste du produit ne connaît que l'interface.** C'est ce qui rend
les six écrans livrables et testables aujourd'hui.

---

## 10. Plan de réalisation (pour Sonnet — écran par écran, commits atomiques)

Principes hérités du chantier offres, non négociables : **SSOT, commits atomiques, zéro duplication, zéro
régression, typecheck + tests verts à chaque étape, aucune nouvelle primitive UI.** Chaque lot ci-dessous =
un commit.

- **Lot 0 — Fondations & drapeau.** Feature flag `PREMIUM_MISSION_ENABLED` (OFF en prod tant que canal réel
  absent, §1). Types SSOT dans `packages/core` : `SellMandate`, `SellPosture` (+ préréglages),
  `MissionStatus`. Enum Mission dans `schema.prisma` → régénérer `enums.ts`. Tests unitaires des
  préréglages de posture. *DoD : `npm run typecheck` + `npm run test` verts.*
- **Lot 1 — S1 posture.** Écran « Configurez votre IA », branché après « Valider et publier » (Premium
  uniquement). Réutilise le pattern radio de l'écran offres. Aucun appel réseau. *DoD : preview device,
  4 postures sélectionnables, a11y radiogroup.*
- **Lot 2 — S2 assistant.** Feuille 4 questions, valeurs par défaut pré-remplies, validation prix (R : mini
  ≤ affiché). *DoD : chemin rapide 4 taps, erreur prix testée.*
- **Lot 3 — S3 mandat.** Écran récap + garanties + « Confirmer ». À ce stade « Confirmer » crée la Mission
  en `BROUILLON_MANDAT` puis `EN_VENTE` via un service serveur **stub** (pas encore de négociation).
  *DoD : mandat persisté, transition d'état vérifiée en test.*
- **Lot 4 — Canal simulé + machine à états.** `NegotiationChannel` + `SimulatedChannel`, règles R1–R9 en
  contrôles serveur, machine à états §6. *DoD : tests couvrant chaque règle et chaque transition, y compris
  refus sous prix mini et route des cas complexes.*
- **Lot 5 — S4 Mission.** Tableau de bord : bandeau d'état, section « en attente », timeline, `EmptyState`,
  `Skeleton`, menu suspendre/arrêter. Alimenté par le canal simulé. *DoD : les 6 états rendus, écran serein
  quand rien en attente.*
- **Lot 6 — S5 validation.** Feuille de validation, 3 variantes (offre / prix mini exact / alerte
  sécurité / cas complexe), application de R4. *DoD : accepter → Vendu ; offre retirée gérée.*
- **Lot 7 — S6 fin de mission + Lot 8 notifications.** Écran récap premium ; notifications §7 avec
  anti-spam. *DoD : célébration sobre, une seule notif de négo/heure.*
- **Lot 9 — Branchement canal réel (différé).** Implémenter l'autre `NegotiationChannel` quand l'accès
  partenaire existe ; lever le flag. **Aucune autre partie du code ne change** (c'est tout l'intérêt de la
  frontière §9).

Ordre de valeur : Lots 1→3 donnent déjà la **démo complète du mandat** (le « je délègue » se ressent) ;
Lots 4→6 donnent la **négociation supervisée** ; 7→8 le **premium ressenti** ; 9 la **mise en production
réelle**.

---

## 11. Décisions écartées (traçabilité)

- ❌ Champ « négociation max % » séparé du prix mini → **redondant** (fusionné en un prix concret, § 4.2).
- ❌ Prix « acceptation immédiate / coup de cœur » → **3ᵉ notion de prix sans valeur nette**.
- ❌ Système de réputation propriétaire → **hors promesse, coûteux** ; on n'utilise que le public plateforme.
- ❌ Curseurs de réglage exposés à l'écran posture → **casse la simplicité radicale** ; cachés derrière 4 mots.
- ❌ Push « négociation en cours » → **bavardage** ; timeline seulement.
- ❌ Confettis / animations de célébration bruyantes → **anti-premium** ; sobriété.
- ❌ Coup de marteau automatique par défaut → on **délègue la corvée, pas la décision** ; opt-in enterré.
- ❌ Réglages avancés multiples (ton, créneaux…) → **gadgets** ; un seul interrupteur avancé.

---

*Fin du document. Prochaine action attendue : validation de la conception par Maxime, puis exécution du
Lot 0 par Sonnet.*
