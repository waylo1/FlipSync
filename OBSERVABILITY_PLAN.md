# FlipSync Mission Control — Plan Observabilité (NOC)

> **Pour Sonnet.** Exécute les tâches **dans l'ordre**, une par une, sans agents, sans boucle.
> Chaque tâche est autonome et testable. Commit après chaque tâche verte.
> Ce plan transforme la console en centre de supervision opérationnelle **en n'affichant
> QUE des données réelles**. Voir « Règle d'or » ci-dessous.

## Règle d'or — zéro fabrication

CLAUDE.md interdit les données inventées (finance en centimes, « pas de fausses courbes »,
décisions prod « assumées jusqu'à décision »). Ici :

- **N'affiche jamais une métrique que le backend ne produit pas réellement.** Pas de CPU
  aléatoire, pas de latence Claude/Gemini (FlipSync n'utilise pas ces providers), pas de
  service Railway/Redis/GitHub (absents de la stack).
- **Les 6 « agents » (ATLAS/VEGA/ORION/LYRA/NOVA/RHEA) ne sont PAS des process.** Ce sont
  des vues de sous-systèmes dérivées de `/admin/overview`. → **Aucun bouton Restart / Kill /
  Pause / Resume / Terminal.** Ils ne piloteraient rien.
- Le **seul backend d'inférence réel** est **Ollama qwen2.5vl:3b** (`OLLAMA_BASE_URL`,
  `OLLAMA_MODEL`). Le monitoring IA cible celui-là, pas un trio Claude/Gemini/OpenAI.
- La **file d'attente réelle** = table `DraftJob` (statut RUNNING). Pas de Redis.
- Marketplace `MISSING` est l'**état attendu actuel** (credentials partenaires en attente) :
  ne le compte PAS comme une panne dure dans le health score (sinon le score est bloqué bas
  et devient inutile). C'est un WATCH informatif.

## Symboles réels du backend (déjà en place — à réutiliser, ne pas réinventer)

- App Fastify assemblée dans `apps/api/src/app.ts` (`buildApp()`).
- Décorateurs : `app.authenticate`, `req.userId`, `app.walletService`, `app.listingEngine`,
  `app.publicationService`, `app.visionService`.
- Prisma (`@flipsync/db`) : modèles `listing`, `walletTransaction`, `userWallet`, `draftJob`,
  `user`. Enums `ListingStatus`, `TransactionType`, `DraftJobStatus` (RUNNING/READY/FAILED).
- Garde admin : `requireAdmin` + `preHandler` dans `apps/api/src/routes/admin.ts`, préfixe `/admin`.
- Front : store Zustand `apps/web/src/store/useMissionControlStore.ts` (pattern
  `fetchAgents` / `startPolling(intervalMs)` / `stopPolling`), client `apps/web/src/services/api.ts`,
  composants dans `apps/web/src/components/MissionControl/`.
- Tests API : Vitest, fichiers `*.db.test.ts`, via `app.inject(...)`.

## Conventions d'exécution

- `strict: true`, **jamais `any`**. Enums TS = miroir Prisma.
- Backend d'abord pour chaque capacité, puis le front qui le consomme → chaque phase est
  démontrable de bout en bout.
- `/admin/overview` reste inchangé (compat : le store l'utilise). Les nouveaux endpoints
  sont **additifs**.
- Chaque tâche : `npm run typecheck` (web + api) vert, test ciblé quand indiqué, puis commit
  `feat(obs): Tn — …`.
- Perf React : `memo` sur les composants de liste, `react-window` pour les logs longs (T15).
- A11y : `motion-safe:` sur toute animation, `aria-label`, `focus-visible`, `aria-live` sur
  les flux temps réel.

---

# PHASE 0 — Fondation backend (métriques, santé, événements)

## T1 — Plugin métriques (compteurs trafic + snapshot système)
**But :** collecter en mémoire, en continu, les vraies métriques du process API.
**Fichiers :** `apps/api/src/plugins/metrics.ts` (nouveau), enregistré dans `app.ts` avant les routes.
**Comment :**
- `fastify-plugin`. Décore `app.metrics`.
- Hook `onResponse` : pousse `{ ts, ms: reply.elapsedTime, status: reply.statusCode }` dans
  une fenêtre glissante (array plafonné à ~2000, ou buckets par minute). Ignore les routes
  `/admin/*` pour ne pas fausser (le polling console gonflerait le trafic) — filtrer par `req.url`.
- Compteurs cumulés `totalReq`, `totalErr` (status >= 500).
- CPU% réel : au boot, mémorise `process.cpuUsage()` + `hrtime`. Méthode `sample()` qui
  calcule le delta µs / temps écoulé / `os.cpus().length` × 100. Appelée à chaque lecture.
- Expose `app.metrics.snapshot()` → `{ system, traffic }` :
  - `system`: `{ cpuPct, memRssMb, memHeapUsedMb, uptimeSec, pid, node: process.version }`
    (RAM via `process.memoryUsage()`, uptime via `process.uptime()`).
  - `traffic`: `{ reqPerMin, errPerMin, p50Ms, p95Ms, totalReq, totalErr, windowSec: 60 }`
    calculés sur les 60 dernières secondes de la fenêtre.
- **Pas de disque** : non pertinent ici, ne pas l'inventer. (Si vraiment voulu plus tard :
  vrai check via lib dédiée, tâche séparée.)
**Test :** `apps/api/src/metrics.test.ts` — après quelques `app.inject`, `snapshot().traffic.totalReq > 0`.
**Note honnêteté :** métriques in-process → remises à zéro au redémarrage. Labellise côté UI
« fenêtre glissante / depuis démarrage », pas « all-time ».

## T2 — Service santé + `GET /admin/health`
**But :** état réel de chaque dépendance + score global.
**Fichiers :** `apps/api/src/services/health.service.ts` (nouveau) ; route ajoutée dans `admin.ts`.
**Comment :**
- Fonction `checkHealth(app)` qui ping en parallèle, chacun avec timeout court (~2 s) et mesure
  de latence :
  - `database` : `prisma.$queryRaw\`SELECT 1\`` → healthy/down + `latencyMs`.
  - `inference` : `fetch(\`${OLLAMA_BASE_URL}/api/version\`)` → healthy/down + latence.
    Label = `Ollama ${OLLAMA_MODEL}`.
  - `api` : toujours healthy (on répond), détail = uptime.
  - `stripe` : **pas de ping live** (clés test placeholder). Status dérivé de la config :
    `STRIPE_SECRET_KEY` présente et ≠ placeholder → `configured`, sinon `unknown`. Ne pas
    prétendre pinger l'API Stripe.
  - `marketplace-vinted` / `marketplace-leboncoin` : réutilise la logique `connectorState`
    existante (LIVE→healthy, MOCK→warning, MISSING→warning **informatif**, pas down).
- **Cache TTL ~5 s** (les pings ne doivent pas partir à chaque poll) : mémorise le dernier
  résultat + timestamp.
- `overall` = down si DB ou inference down ; sinon warning si au moins un warning ; sinon healthy.
- `score` (0–100) — formule **documentée en commentaire** :
  `100 − (DB down ? 40 : 0) − (inference down ? 25 : 0) − min(20, errPerMin×2)
   − (aiRunning > SEUIL ? 10 : 0)`. Marketplace MISSING/MOCK : **−0** (état attendu), juste
  reflété dans `services[]`. Clamp 0–100.
- Route `GET /admin/health` (dans le bloc `adminRoutes`, déjà gardé JWT + requireAdmin) →
  `{ ts, overall, score, services: [{ id, label, status, latencyMs?, detail? }] }`.
**Test :** `app.inject` GET `/admin/health` avec token admin → 200, `services` contient `database`
et `inference`, `score` ∈ [0,100].

## T3 — `GET /admin/metrics`
**But :** exposer T1 + file + version au front.
**Fichiers :** `admin.ts`.
**Comment :** route `GET /admin/metrics` →
```
{
  ts,
  system: app.metrics.snapshot().system,
  traffic: app.metrics.snapshot().traffic,
  queue: {
    aiRunning: await prisma.draftJob.count({ where: { status: RUNNING } }),
    aiReady24h: count(READY, updatedAt≥24h),
    aiFailed24h: count(FAILED, updatedAt≥24h),
  },
  version: { app: <version package.json>, gitSha?: process.env.GIT_SHA, env: NODE_ENV },
}
```
Version app : importe la version depuis `package.json` (ou constante). `gitSha` optionnel
(injecté au build, absent en dev → ne pas afficher si vide).
**Test :** GET `/admin/metrics` → 200, `system.uptimeSec ≥ 0`, `queue.aiRunning` numérique.

## T4 — Enregistreur d'événements + `GET /admin/events` (in-memory)
**But :** une vraie timeline d'événements métier, pas des logs synthétisés depuis un snapshot.
**Fichiers :** `apps/api/src/plugins/events.ts` (nouveau, décoré `app.events`) ; instrumentation
dans les routes existantes ; route dans `admin.ts`.
**Comment :**
- Ring buffer en mémoire (dernier 500). `app.events.record({ source, type, level, message, meta? })`
  ajoute `{ id, ts }`. `level ∈ 'info'|'success'|'warning'|'error'`.
- **Points d'émission RÉELS** (câbler `app.events.record` aux endroits qui existent déjà) :
  - `routes/ai.ts` : job start (`info`, source `ORION`), job READY (`success`, avec `ms`),
    job FAILED (`error`, avec `errorCode`).
  - `routes/listing.ts` : transitions clés (authorized, validated, queued, published, failed) —
    à poser aux endroits où le statut change.
  - `services/publication.service.ts` : publish success (`success`), publish fail (`error`,
    `failureReason`).
  - `routes/admin.ts` : accès refusé `NOT_ADMIN` (`warning`, source `LYRA`) — sécurité.
- Route `GET /admin/events?limit=&level=&source=` → `{ events: [...] }` (récents d'abord).
**Test :** provoque un `NOT_ADMIN` via inject (token non-admin) puis GET `/admin/events` (token admin)
→ l'événement `warning` est présent.
**Note :** in-memory volatile (perdu au redémarrage). La persistance DB + recherche = T14/T15.

---

# PHASE 1 — Fondation front + supervision temps réel

## T5 — Étendre le client + le store aux nouvelles ressources
**Fichiers :** `apps/web/src/services/api.ts`, `apps/web/src/store/useMissionControlStore.ts`.
**Comment :**
- `api.ts` : types `SystemHealth`, `SystemMetrics`, `SystemEvent` (miroirs exacts des payloads
  T2/T3/T4) + méthodes `getHealth()`, `getMetrics()`, `getEvents()`.
- Store : ajoute `health`, `metrics`, `events` à l'état. Généralise `fetchAgents` → un
  `refresh(silent)` qui `Promise.all([getOverview, getHealth, getMetrics, getEvents])` et
  met tout à jour (garde `fetchAgents` comme alias pour compat / le bouton Refresh).
  `startPolling(intervalMs)` inchangé dans son principe (nettoyage déjà correct).
- **Remplace** `buildLogs()` synthétique par le vrai flux `events` (les logs affichés viennent
  désormais de `/admin/events`). `buildAlerts()` peut rester (dérivé) OU être nourri par les
  events `level:'error'` — au choix, mais documente.
**Test :** typecheck web ; en preview, `useMissionControlStore.getState().metrics` non-null après refresh.

## T6 — `SystemHealthBar` (barre de santé services)
**Fichiers :** `apps/web/src/components/MissionControl/SystemHealthBar.tsx` (nouveau), monté en
haut du `Dashboard.tsx`.
**Comment :** rangée compacte de pastilles par service (`health.services`) : dot coloré
(healthy=nominal, warning=watch, down=alert) + label + latence en `tabular-nums`. `motion-safe`
pulse sur down. `title`/`aria-label` avec `detail`. Pas de service absent de la stack.
**Test (preview) :** la barre affiche API / Postgres / Ollama / Vinted / Leboncoin avec les bons états ;
couper Ollama (arrêter le service) → la pastille inference passe à `down` au poll suivant.

## T7 — `KpiStrip` (cartes KPI compactes)
**Fichiers :** `apps/web/src/components/MissionControl/KpiStrip.tsx` (nouveau), sous la health bar.
**Comment :** cartes bordées compactes, chiffres `tabular-nums` : CPU %, RAM (MB), Uptime
(format `Xd Yh Zm`), Latence p95, Req/min, Err/min (rouge si >0), File IA (aiRunning), Score santé.
Chaque carte : label 10px + valeur dominante. Seuils de couleur (ex. CPU>80 % watch, err/min>0 alert).
**Test (preview) :** valeurs cohérentes avec `/admin/metrics` (compare via preview_network) ;
uptime croît entre deux polls.

---

# PHASE 2 — Événements & logs intelligents

## T8 — `EventTimeline` (timeline chronologique)
**Fichiers :** `apps/web/src/components/MissionControl/EventTimeline.tsx` (nouveau) ; remplace le
panneau « Logs Système » actuel du `Dashboard.tsx`.
**Comment :** liste verticale type timeline Git : rail vertical + puce colorée par `level`,
heure `tabular-nums`, source (badge), message. Ordre antéchronologique. `aria-live="polite"`.
`memo` sur la ligne. Chaque ligne cliquable (→ T9).
**Test (preview) :** déclenche un job IA (ou un `NOT_ADMIN`) et vois l'événement apparaître au poll.

## T9 — `LogDrawer` (tiroir latéral détail + Copy)
**Fichiers :** `apps/web/src/components/MissionControl/LogDrawer.tsx` (nouveau) ; état `selectedEvent`
dans le store.
**Comment :** drawer latéral (translate-x, `motion-safe`, scrim 40–60 %, `Escape` ferme,
focus-trap). Affiche tout le `meta` de l'événement : type, date, source, message, `errorCode`,
`ms`, `failureReason`, etc. (uniquement les champs réellement présents). Bouton **Copy Error**
(copie un JSON de l'événement dans le presse-papier — pour coller dans Claude). Bouton « Filtrer
les événements de cette source » (→ pré-remplit la recherche T15 quand elle existe).
**Ne pas** mettre « Retry / Restart agent » (pas de process ; cf. Règle d'or). Une action de
**retry réelle** (relancer un job IA échoué) touche wallet/état → tâche durcie séparée, hors de ce plan.
**Test (preview) :** clic sur une ligne error → drawer ouvert, Copy remplit le presse-papier
(`preview_eval navigator.clipboard`… ou vérifie l'état).

---

# PHASE 3 — Score, dépendances, diagnostic

## T10 — `HealthScoreGauge` + tuile Uptime/Version
**Fichiers :** `apps/web/src/components/MissionControl/HealthScore.tsx` (nouveau), dans le header.
**Comment :** jauge/barre `health.score` (0–100) colorée par palier (≥90 nominal, ≥70 watch, <70 alert),
+ `overall` en libellé. Tuile secondaire : uptime (`metrics.system.uptimeSec`), version
(`metrics.version.app` + `env`), gitSha si présent. Tout réel.
**Test (preview) :** score cohérent avec `/admin/health` ; couper Ollama → score baisse de ~25.

## T11 — `DependencyMap` (carte des dépendances réelle)
**Fichiers :** `apps/web/src/components/MissionControl/DependencyMap.tsx` (nouveau).
**Comment :** SVG, **topologie réelle** :
`Mobile → API → { Postgres, Ollama, Stripe, Vinted, Leboncoin }`. Nœuds colorés par
`health.services[id].status` ; arête **rouge** si la cible est down/warning. `motion-safe` pulse
sur arête en défaut. Légende. **Pas** de « Claude→Mission Manager→Railway→GitHub » (topologie fictive).
`viewBox` responsive, `overflow-x:auto` si étroit.
**Test (preview) :** couper Ollama → l'arête API→Ollama devient rouge.

## T12 — `DiagnosticsPanel` (l'« AI Supervisor », version honnête = moteur de règles)
**Fichiers :** `apps/web/src/lib/diagnostics.ts` (règles pures, testables) +
`apps/web/src/components/MissionControl/DiagnosticsPanel.tsx`.
**Comment :** fonction pure `diagnose({ health, metrics, overview, events })` → liste de
`{ severity, cause, recommendation, confidence: 'certain'|'probable' }` à partir de **signaux réels** :
- inference down → « Ollama injoignable → relancer le service / vérifier `OLLAMA_BASE_URL` ».
- `ai.failed24h ≥ seuil` → « Taux d'échec IA élevé → inspecter les events ORION error ».
- Vinted/Leboncoin MISSING → « Publication bloquée : credentials partenaire absents ».
- err/min élevé, mémoire RSS proche d'un seuil, file IA qui s'accumule, etc.
Libellé du panneau : **« Diagnostic »** (déterministe). **Pas** de faux « 92 % IA ».
*(Enhancement optionnel plus tard, hors plan : résumé langage naturel via le backend d'inférence
réel — faible valeur avec un modèle 3B, à ne faire qu'après décision prod.)*
**Test :** tests unitaires de `diagnose()` (Vitest) sur des snapshots construits à la main.

## T13 — Enrichir `AgentCard` (états riches réels, sans faux contrôles)
**Fichiers :** `AgentCard.tsx`, dérivation dans le store.
**Comment :** statuts plus riches **dérivés de vrais signaux** (pas 6 états décoratifs random) :
`NOMINAL / WATCH / ALERT` déjà là ; ajoute `IDLE` (aucune activité récente) et `BUSY`
(ORION avec `aiRunning>0`) quand c'est calculable. Ajoute des champs réels par carte quand
ils existent : dernière activité (dernier event de cette source), compteur d'échecs 24h.
Bouton unique **« Voir les événements »** → filtre la timeline sur `source = agent`.
**Interdit :** Restart/Kill/Pause/Resume/Terminal (rien derrière).
**Test (preview) :** lancer un job IA → ORION passe `BUSY` avec la bonne dernière activité.

---

# PHASE 4 — Persistance, historique, recherche

## T14 — Persister les événements (`AdminEvent` Prisma) + rétention
**Fichiers :** `packages/db/prisma/schema.prisma` (modèle `AdminEvent` + migration),
`apps/api/src/plugins/events.ts` (écrit aussi en DB), `admin.ts`.
**Comment :** modèle `AdminEvent { id, ts, source, type, level, message, meta Json?, createdAt }`.
`app.events.record` écrit en base (fire-and-forget, ne bloque pas la requête). `GET /admin/events`
lit désormais la DB avec filtres serveur : `level`, `source`, `since`, `q` (recherche message),
`limit`/`cursor` (pagination). Job de rétention simple (supprime > N jours ou garde N derniers).
**Test :** inject events → GET avec `?level=error&q=…` filtre correctement.

## T15 — Recherche & historique dans la timeline (+ virtualisation)
**Fichiers :** `EventTimeline.tsx` + barre de filtres.
**Comment :** filtres INFO/WARNING/ERROR/SUCCESS, par source, par date, champ recherche →
appelle `/admin/events` (params T14). Pagination « charger plus ». `react-window` si la liste
dépasse ~100 lignes (perf, extensibilité multi-dizaines de sources). Debounce la recherche.
**Test (preview) :** filtrer sur `error` ne montre que les erreurs ; la liste reste fluide à 1000+.

## T16 — (Enhancement) Flux SSE temps réel `GET /admin/stream`
**Fichiers :** `admin.ts` (endpoint SSE), store (abonnement EventSource, fallback polling).
**Comment :** Server-Sent Events pousse chaque nouvel event + tick métriques → remplace une partie
du polling par du vrai push (plus « vivant », moins de requêtes). Garder le polling en fallback.
**Test (preview) :** un nouvel event apparaît sans attendre le prochain intervalle de poll.

---

# REPORTÉ — à ne PAS faire maintenant (raisons)

- **Contrôles de cycle de vie agent** (Restart/Kill/Pause/Resume/Terminal) : les agents ne sont
  pas des process. Rien à piloter. À reconsidérer seulement si FlipSync introduit de vrais
  workers autonomes.
- **Auto-healing / escalade Discord** : nécessite des process supervisés (absents). Théâtre sinon.
- **Actions mutatives** (retry job IA, re-publish) : touchent wallet/`ListingStatus`/argent réel.
  Exigent write-auth admin, idempotence, garde transactionnelle. Tâche durcie dédiée, hors de ce plan.
- **Mode Replay** (rejeu chronologique d'incident) : possible **seulement après T14** (events
  persistés + rétention). Alors : endpoint `GET /admin/events?from=&to=` + lecteur temporel front.
  Le mettre en tâche T17 quand T14/T15 sont livrés.
- **Monitoring multi-provider + coûts/tokens Claude/Gemini/OpenAI** : aucun de ces providers n'est
  utilisé. À activer quand la **décision prod d'inférence** (CLAUDE.md Sprint 4) est prise, en
  branchant les vrais coûts du provider retenu.

---

## Ordre de commit recommandé
T1→T2→T3→T4 (backend vert + testé) puis T5→T6→T7 (supervision visible) puis T8→T9 (events),
T10→T11→T12→T13 (score/carte/diagnostic/cartes), enfin T14→T15→T16 (persistance/recherche/SSE).
Chaque Tn = un commit `feat(obs): Tn — <titre>`. Ne pas grouper. Ne pas sauter les tests indiqués.
