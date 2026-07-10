# FlipSync — Roadmap technique 2 à 6 mois

> **Nature de ce document.** Ce n'est pas un plan d'implémentation. C'est une **boussole
> d'architecture** : elle sert à ce que les décisions prises aujourd'hui n'enferment pas les
> évolutions de demain. Rédigée du point de vue CTO. Aucune fonctionnalité fictive, aucune donnée
> inventée, aucune techno imposée sans justification. Développement incrémental, compatible avec
> l'existant.
>
> **Exécution court terme :** voir [OBSERVABILITY_PLAN.md](OBSERVABILITY_PLAN.md) (T1–T16).
> Ce document couvre l'arc plus long et les décisions qui l'encadrent.

---

## Principes directeurs (non négociables)

1. **Modular monolith, pas microservices.** Un fondateur solo n'a pas le budget d'exploitation
   d'une architecture distribuée. Le monorepo actuel (`apps/*` + `packages/*`) est le bon niveau
   de découpage : des frontières nettes *dans* un seul déployable.
2. **La ressource la plus rare est le temps de Maxime, pas le CPU.** Chaque évolution est jugée
   au ratio **valeur / complexité d'exploitation**, pas à sa sophistication.
3. **Anticiper les interfaces, pas les implémentations.** On stabilise des *contrats* tôt (peu
   cher). On repousse les *machineries* tard (cher, souvent jamais nécessaire).
4. **Zéro fabrication.** Une métrique, une alerte ou un coût affichés doivent venir d'une mesure
   réelle. Ce principe, déjà tenu dans l'OBSERVABILITY_PLAN, gouverne aussi la roadmap.

---

## Item 0 — La décision qui conditionne tout : l'inférence prod

Aujourd'hui : Ollama `qwen2.5vl:3b` en dev (CPU, 70–90 s/photo froide), **prod non décidée**
(cf. CLAUDE.md Sprint 4). Tant que ce choix n'est pas fait, plusieurs pistes de ta liste sont
**indécidables** (coûts IA, workers, multi-moteurs). C'est donc le **premier verrou à lever**,
avant toute ambition d'analytics ou de scaling.

**Le seam existe déjà et c'est une bonne nouvelle.** `packages/ai` expose
`VisionService(backend, timeout)` où `backend` implémente une interface (`OllamaVisionBackend`).
Changer de fournisseur = **écrire une deuxième implémentation** + un sélecteur par config. Pas de
refonte. C'est exactement l'abstraction qu'il faut protéger (cf. §3).

**Cadre de décision (je recommande, je n'impose pas) :**

| Critère | API hébergée (ex. Claude Haiku 4.5) | GPU loué + Ollama |
|---|---|---|
| Charge d'exploitation | ~0 (pas de serveur à tenir) | Élevée (uptime, drivers, patchs, sécurité) |
| Coût à faible volume | ~0,5 c€/annonce, prévisible | 30–80 €/mois fixes, quel que soit le volume |
| Qualité FR + JSON structuré | Forte | Dépend du modèle chargé |
| Point de bascule | Rentable tant que le volume est bas/moyen | Rentable seulement à fort volume soutenu |

**Recommandation CTO : démarrer en API hébergée.** Pour un solo, la charge d'exploitation d'un
GPU (le maintenir en vie, à jour, sécurisé) est un mauvais emploi du temps le plus rare. Le coût
par appel est négligeable au volume de démarrage. On **rebascule vers un GPU seulement si** le
coût par appel finit par dominer l'économie d'exploitation — décision *dérivée d'une donnée
réelle* (le coût/annonce mesuré, cf. §5), pas d'une intuition.

**Conséquence forte, souvent ignorée :** en API hébergée, l'inférence lourde part **hors du
process API**. Le débat « workers séparés » (ci-dessous) perd alors 90 % de sa pertinence pour
tout l'horizon 2–6 mois. C'est un exemple parfait d'une décision amont qui *supprime* du travail
aval au lieu d'en créer.

---

## 1. Évolutions probables (avec le « pourquoi »)

Classées par probabilité d'apporter de la valeur réelle dans l'horizon.

### 1.1 — Observabilité persistée → socle de tout le reste **(très probable)**
Les événements en mémoire (OBSERVABILITY_PLAN T4) sont volatils. Les **persister** (T14,
table `AdminEvent`) débloque *d'un coup* : historique, recherche, analytics, alerting, et plus
tard le replay. **Pourquoi maintenant :** instrumenter les points d'émission coûte peu
aujourd'hui et **ne se rattrape pas** — on ne peut pas fabriquer a posteriori des événements
qu'on n'a pas enregistrés. C'est le meilleur investissement de la roadmap.

### 1.2 — Alerting seuil → email **(très probable, quasi gratuit)**
Quand Ollama tombe, qu'un lot de publications échoue, ou que le taux d'erreur grimpe, Maxime doit
l'apprendre **sans regarder le dashboard**. Le `EmailService` est déjà injectable (utilisé par le
magic link). Un moteur de seuils qui réutilise ce service = valeur opérationnelle immédiate.
**Pourquoi :** un NOC qu'il faut fixer des yeux ne sert à rien pour une personne seule.

### 1.3 — Suivi du coût par annonce **(probable — conditionné par Item 0)**
Dès que l'inférence prod est une API payante, chaque annonce a un **coût réel** (tokens/appel).
Le rapprocher du **prix facturé** (déjà en centimes, `WalletService`) donne la **marge réelle**
par palier SIMPLE/OPTIMIZED/PREMIUM. **Pourquoi :** c'est ce qui transforme le dashboard de
« supervision technique » en « pilotage de rentabilité ». Impossible avant Item 0.

### 1.4 — Monitoring fin des publications **(probable, quand les connecteurs passent LIVE)**
Aujourd'hui les connecteurs sont des squelettes (`MISSING`). Quand les credentials partenaires
arrivent, la publication devient le **cœur de métier** — et son point de fragilité (dépend d'APIs
tierces). Il faudra : taux de succès par plateforme, latence, causes d'échec, et **fiabilité**
(idempotence + retry, cf. §2.4). **Pourquoi :** un échec de publication = remboursement wallet =
argent réel qui bouge ; on doit le voir finement.

### 1.5 — Analytics produit **(probable, dérivé de 1.1)**
Une fois les événements persistés, des agrégats SQL simples (annonces/jour, taux de succès IA,
latence moyenne, palier le plus vendu) sont **quasi gratuits**. **Pourquoi :** décisions produit
(quel palier marche, où ça casse) au lieu d'intuitions.

### 1.6 — Recherche avancée dans l'historique **(probable, dérivé de 1.1)**
Filtres par source/niveau/date/mission + recherche plein texte (OBSERVABILITY_PLAN T15).
**Pourquoi :** diagnostiquer un incident précis en secondes. N'a de sens **qu'après** la
persistance (1.1).

### 1.7 — Multi-comptes vendeurs (per-user marketplace tokens) **(possible, selon modèle)**
Aujourd'hui : un **compte partenaire global** (tokens en variables d'env). Si FlipSync connecte
les comptes *des vendeurs*, il faudra des tokens **par utilisateur**. Le seam existe déjà : le
`CredentialsResolver` prend `userId` en paramètre (TODO `MarketplaceAccount` déjà noté).
**Pourquoi *possible* et pas *probable* :** dépend d'une décision *produit* (agit-on au nom d'un
compte unique, ou de chaque vendeur ?) non encore tranchée. On **anticipe l'interface**, on ne
**construit pas** la table tant que le modèle n'est pas décidé.

### Ce que je remets en question dans ta liste

- **« Supervision distribuée »** → **pas pertinent** dans l'horizon. Il y a **un seul process
  API**. Superviser « plusieurs nœuds » supposerait un système qu'on n'a pas et qu'un solo ne
  devrait pas se créer. La console supervise un process : c'est correct, restons-y.
- **« Workers séparés »** → **conditionnel, probablement inutile** (cf. Item 0). En API hébergée,
  l'inférence est déjà « ailleurs ». Un worker séparé ne se justifierait que si l'on reste en
  **auto-hébergé GPU** *et* que le volume sature le process. Ne pas le construire par principe.
- **« Gestion de plusieurs moteurs IA »** → à **reformuler**. La valeur n'est pas de faire
  tourner Claude *et* Gemini *et* OpenAI en parallèle (aucun n'est utilisé aujourd'hui), mais de
  pouvoir **remplacer** le backend et éventuellement avoir **un fallback** (primaire indispo →
  secondaire). Ça, c'est cheap si l'interface `VisionBackend` reste propre (§3.1). Le
  « multi-moteurs simultané » est une complexité sans demande réelle.

---

## 2. Décisions d'architecture : anticiper / attendre / surtout pas maintenant

Règle : on paie **tôt** ce qui est *irréversible ou coûteux à rétrofit* (contrats, événements),
**tard** ce qui est *isolable derrière une interface* (implémentations).

### 2.1 — Inférence prod
- **Anticiper :** garder `VisionBackend` **agnostique** (aucune fuite d'API Ollama dans le
  contrat) ; sélection du backend par **config**, pas par `import` en dur.
- **Attendre :** l'implémentation du second backend jusqu'à la décision Item 0.
- **Jamais prématurément :** un routeur multi-fournisseurs. Un `if config` suffit d'abord.

### 2.2 — Journal d'événements
- **Anticiper :** la **forme** de l'événement et l'**instrumentation** des points d'émission
  (irréversible : pas de backfill possible). Une **taxonomie typée** des types d'événements.
- **Attendre :** la recherche avancée, le replay, les agrégats.
- **Jamais prématurément :** une base time-series dédiée (Prometheus/Grafana). Postgres +
  agrégats suffisent à cette échelle ; un TSDB est une charge d'exploitation injustifiée.

### 2.3 — Jobs asynchrones
- **Anticiper :** rien de plus que l'existant. `DraftJob` (Postgres) est le bon niveau.
- **Attendre :** un modèle de job **générique** jusqu'à ce qu'un **deuxième** type de job
  apparaisse réellement (ex. publication en lot). Avant ça, généraliser = spéculatif.
- **Jamais prématurément :** Redis / BullMQ / une file externe. Introduit une dépendance
  d'infra (donc de l'exploitation) que le volume ne justifie pas, surtout en API hébergée.

### 2.4 — Fiabilité de publication (quand LIVE)
- **Anticiper :** une **clé d'idempotence** par tentative de publication (éviter les doublons si
  retry) — même si le retry n'est pas encore automatique, réserver le champ/concept. Le socle
  `PUBLISH_FAILED` + remboursement auto existe déjà : c'est le bon point d'accroche.
- **Attendre :** le retry automatique avec backoff, le dead-letter.
- **Jamais prématurément :** un orchestrateur de workflow (Temporal, etc.). Sur-dimensionné.

### 2.5 — Multi-comptes vendeurs
- **Anticiper :** garder la signature `CredentialsResolver(userId, marketplace)` (déjà le cas).
- **Attendre :** la table `MarketplaceAccount` + le flux OAuth par vendeur jusqu'à décision produit.
- **Jamais prématurément :** un système multi-tenant complet (RBAC, isolation) pour un produit
  qui n'a pas encore ses premiers vendeurs connectés.

---

## 3. Interfaces à stabiliser dès maintenant (pour ne pas réécrire dans 6 mois)

Ce sont les **contrats** dont la stabilité évite une refonte. Peu coûteux à figer aujourd'hui.

### 3.1 — `VisionBackend` (packages/ai) — **le seam d'inférence**
Contrat : `photos[] (+ palier/nb photos) → ListingDraft (Zod)`. **À protéger :** aucune notion
propre à Ollama ne doit remonter dans l'interface. C'est ce qui rend la décision Item 0
réversible et le fallback possible. **Le contrat le plus important du projet.**

### 3.2 — Le schéma d'événement — **la colonne vertébrale de l'observabilité**
`{ ts, source, type, level, message, meta }` avec une **enum de `type`** partagée. Le figer tôt
parce que **tout** en dépend en aval (historique, analytics, alerting, replay). Un schéma ad hoc
qui dérive = migration douloureuse de données déjà accumulées.

### 3.3 — Le contrat de l'API `/admin/*` — **partagé, pas re-tapé à la main**
Risque concret **aujourd'hui** : `apps/web/src/services/api.ts` **re-déclare à la main** les
types du payload (`AdminOverview`, etc.). Front et back peuvent **diverger en silence**.
**Recommandation :** déplacer ces types de payload dans un endroit partagé (`packages/core`) que
`apps/api` **et** `apps/web` importent. Coût faible, supprime une classe entière de bugs de dérive
au moment précis où l'on va **multiplier** les endpoints admin (health, metrics, events…).

### 3.4 — `CredentialsResolver` — **le seam multi-vendeurs**
Déjà bien conçu (prend `userId`). Ne pas le simplifier en « token global » ailleurs dans le code :
tout doit passer par ce résolveur, pour que le passage env→DB soit indolore.

### 3.5 — Le pattern du store front (`fetch* / startPolling / stopPolling`)
Récemment rendu explicite et propre. **À généraliser proprement** quand on ajoutera health/metrics/
events (une ressource = une action + un sélecteur), plutôt que d'empiler des `load()` ad hoc.

---

## 4. Risques : ce qui, aujourd'hui, pourrait devenir bloquant

| Risque | Nature | Gravité | Mitigation |
|---|---|---|---|
| **Dérive de types front/back** (`api.ts` re-tapé) | Couplage implicite | Moyenne, **croissante** | §3.3 — types partagés `packages/core` **avant** de multiplier les endpoints admin |
| **Événements non enregistrés** | Manque de journalisation | Élevée (irréversible) | Instrumenter tôt (OBSERVABILITY_PLAN T4) — on ne backfill pas le passé |
| **Événements en mémoire** perdus au redémarrage | Pas d'historique | Moyenne | Persister (T14) avant de bâtir analytics/replay dessus |
| **Inférence prod indécidée** | Blocage produit | Élevée | Item 0 — trancher tôt ; le seam §3.1 rend le choix réversible |
| **Inférence couplée au process API** (si GPU auto-hébergé) | Couplage fort | Moyenne | Préférer l'API hébergée (Item 0) ; sinon isoler plus tard |
| **Compte partenaire global** (tokens env) | Couplage au modèle mono-compte | Faible aujourd'hui | Seam §3.4 déjà en place ; ne pas le contourner |
| **Observabilité qui capte de la PII** | Conformité (RGPD, Supabase EU) | Élevée si négligée | Garder la discipline existante (`redact`, « jamais de données nominatives » côté admin) ; définir ce que `meta` a le droit de contenir |
| **Sur-engineering** (le vrai risque solo) | Dette d'exploitation auto-infligée | Élevée | §6 — liste explicite de ce qu'on ne construit pas |

**Le risque n°1 n'est pas technique : c'est le sur-engineering.** Chaque brique d'infra ajoutée
(Redis, TSDB, worker, orchestrateur) est une chose de plus à maintenir seul. La dette la plus
chère pour FlipSync n'est pas « pas assez d'archi » — c'est « trop d'archi pour une personne ».

---

## 5. Opportunités : forte valeur, faible complexité

Les meilleurs ratios, à privilégier.

| Opportunité | Valeur | Coût | Pourquoi c'est un bon deal |
|---|---|---|---|
| **Instrumenter les événements maintenant** | Très élevée | Faible | Débloque tout l'aval ; irréversible si oublié |
| **Alerting seuil → email** | Élevée | Très faible | Réutilise `EmailService` déjà injectable |
| **Types `/admin` partagés** (`packages/core`) | Élevée | Faible | Tue la dérive front/back avant qu'elle coûte |
| **Monitoring externe via `/health`** | Moyenne-élevée | ~0 | Un pinger externe gratuit (UptimeRobot) sur `/health` = supervision *hors du système supervisé*, sans rien coder |
| **Coût/annonce → marge par palier** | Élevée | Faible (après Item 0) | Transforme la supervision en pilotage de rentabilité |
| **Agrégats analytics SQL** | Moyenne-élevée | Faible (après 1.1) | Simple SQL sur les événements persistés |
| **Tests de contrat sur `/admin`** | Moyenne | Faible | Le harnais `*.db.test.ts` existe ; protège la console des régressions |

Le **pinger externe sur `/health`** mérite une mention spéciale : c'est la seule façon d'être
alerté quand **tout le système** (y compris le dashboard) est à terre. Un NOC interne ne peut pas
signaler sa propre mort. Quasi zéro effort, angle mort couvert.

---

## 6. À ne PAS faire maintenant (avec justification technique)

| À éviter | Pourquoi |
|---|---|
| **Redis / BullMQ / file externe** | `DraftJob` (Postgres) suffit ; en API hébergée l'inférence est déjà déportée. Dépendance d'infra = charge d'exploitation sans demande réelle. |
| **Workers / process séparés** | Voir Item 0 : non justifié en API hébergée ; à reconsidérer *seulement* si GPU auto-hébergé **et** saturation mesurée. |
| **Microservices / découpage réseau** | Le monolithe modulaire est correct pour un solo. Le réseau ajoute latence, pannes partielles et ops. |
| **Base time-series (Prometheus/Grafana)** | Postgres + agrégats couvrent l'échelle. Un TSDB est un système de plus à tenir. |
| **Multi-moteurs IA simultané** | Aucun fournisseur multiple utilisé. Garder un backend *remplaçable* (+ fallback optionnel) ; pas d'orchestration multi-modèles. |
| **Supervision distribuée / multi-nœuds** | Il y a un seul process. Superviser une flotte inexistante. |
| **Auto-healing / escalade automatique** | Rien à « healer » (pas de process autonomes). Théâtre opérationnel. |
| **Contrôles de cycle de vie « agent » (Restart/Kill/Pause)** | Les 6 « agents » sont des vues de sous-systèmes, pas des process. Boutons sans backend. |
| **Mode Replay** | N'a de sens qu'**après** persistance des événements (T14) **et** un volume d'incidents réel. Prématuré avant. |
| **Multi-tenant / RBAC complet** | `ADMIN_EMAILS` (CSV) suffit pour un admin. La table `MarketplaceAccount` attend une décision produit. |
| **Actions mutatives depuis la console** (retry job, re-publish) | Touchent argent (wallet) et `ListingStatus`. Exigent write-auth + idempotence + garde transactionnelle. Tâche durcie dédiée, pas un bouton vite fait. |
| **« AI Supervisor » à score de confiance** | Un diagnostic *déterministe* (règles sur signaux réels) est honnête et fiable. Un « 92 % de confiance » simulé est de la donnée inventée — surtout avec un modèle 3B. |

---

## Séquencement conseillé (l'ordre a un sens)

1. **Trancher Item 0** (inférence prod) — débloque coûts, workers, multi-moteurs.
2. **Socle observabilité persisté** (OBSERVABILITY_PLAN, en particulier l'instrumentation
   d'événements **tôt** + persistance T14).
3. **Opportunités à haut ratio** (§5) : types partagés, alerting email, pinger externe.
4. **Analytics & coût/marge** (une fois 1 + 2 en place).
5. **Fiabilité publication** au moment où les connecteurs passent LIVE (idempotence, retry).
6. Le reste (recherche avancée, replay) **se dérive** naturellement du socle — pas avant.

**La ligne directrice :** on construit le **socle d'événements** tôt (irréversible), on garde les
**interfaces propres** (réversible = repoussable), et on **refuse activement** l'infra que le
volume ne justifie pas. FlipSync doit rester un système qu'**une seule personne** peut faire
évoluer sereinement sur 2 à 6 mois — la robustesse ici, c'est la sobriété, pas la sophistication.
