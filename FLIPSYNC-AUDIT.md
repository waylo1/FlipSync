# FLIPSYNC-AUDIT.md — Phase 1 (read-only)

> Auditeur adverse, zéro confiance, code réel uniquement. 30 fichiers lus, mono-thread.
> Périmètre : monorepo FlipSync (fichiers d'un projet externe exclus, retirés du repo depuis).
> Sévérité : **S1** bloquant / **S2** majeur / **S3** mineur. Aucun S1 trouvé.

## Table de synthèse (triée par sévérité)

| id | sév | axe | fichier:ligne | résumé |
|---|---|---|---|---|
| F1 | **S2** | H/C | `apps/api/src/routes/listing.ts:177-178` | `validate()` puis `queue()` en 2 transactions séparées → débit orphelin bloqué en `USER_VALIDATED`, irrécupérable |
| F2 | **S2** | C/H | `packages/wallet/src/wallet.service.ts:101-112` | `requiresAutoRecharge` jamais consommé : `authorize()` retourne `authorized:true` + solde fabriqué, `commit()` échouera |
| F3 | **S3** | D | `packages/ai/src/listing-engine.ts:46-50,201` | `editContent` autorisé en `PUBLISHED` : le prix change en local, aucune re-publication → dérive local↔marketplace |
| F4 | **S3** | G/A | `packages/db/prisma/schema.prisma:116-133` | `ChannelPublication` + enum `SalesChannel` morts-nés : zéro consommateur code, ADR promis absent |
| F5 | **S3** | A | `schema.prisma:272` / `marketplace/src/types.ts:4` / `core/.../marketplace.ts:9` | Triple nomenclature plateforme non réconciliée (SSOT éclaté) |
| F6 | **S3** | G | `packages/core/src/types/negotiation.ts:127,171` | Transitions mission `EXPIRED` / `MISSION_FINALIZED` jamais émises → `VENDU`/`EN_VENTE` terminaux de fait |
| F7 | **S3** | A | `apps/mobile/src/services/api.ts:76,133,166` | `ApiListing/ApiMission/ApiWallet` recopiés à la main au lieu d'importer `@flipsync/core` (viole règle SSOT gouvernance) |
| F8 | **S3** | G | `packages/ai/src/vision.ts:6,10,125` ; `routes/listing.ts:47-49` | Commentaires + défauts « IA on-device » contredisent le pivot IA serveur (ADR-003) |
| F9 | **S3** | H | `packages/wallet/src/wallet.service.ts:137-138` | `setMonth(+1)` : reset free-tier dérive (31 janv → 3 mars) |

---

## F1 — Débit orphelin `USER_VALIDATED` (S2)

**fichier:ligne** `apps/api/src/routes/listing.ts:177-178`
```ts
await app.listingEngine.validate(params.data.id, body.data.prixPublie) // tx1 : USER_VALIDATED + wallet.commit (DÉBIT)
const listing = await app.listingEngine.queue(params.data.id)          // tx2 : USER_VALIDATED → QUEUED
```
**preuve** `validate()` ([listing-engine.ts:159](packages/ai/src/listing-engine.ts:159)) débite dans SA transaction ; `queue()` ([:225](packages/ai/src/listing-engine.ts:225)) transite dans une AUTRE. Si `queue()` échoue (crash process, erreur DB transitoire) après le commit de `validate()`, le listing reste `USER_VALIDATED`, **argent débité**.
Recovery impossible via API :
- `LISTING_TRANSITIONS[USER_VALIDATED] = [QUEUED]` seulement ([transitions.ts:28](packages/ai/src/transitions.ts:28)) → `cancel()` (`USER_CANCELLED`) lève `InvalidTransition`, aucun remboursement.
- Aucune route ne pilote `USER_VALIDATED → QUEUED` hors la ligne 178. Un retry `POST /:id/validate` rappelle `validate()` en premier → `DRAFT_READY→USER_VALIDATED` invalide → 409. La ligne 178 n'est jamais réatteinte.

**impact** Utilisateur débité (99–299 c€), listing ni publiable ni annulable ni remboursable. Perte sèche, correction DB manuelle obligatoire. Fréquence faible (échec entre 2 await) mais **conséquence irréversible sur de l'argent réel**.
**fix** Fusionner en UNE transaction : `validate()` transite `DRAFT_READY → USER_VALIDATED → QUEUED` + `commit()` atomiquement (l'état `USER_VALIDATED` est interne/transitoire). Ou exposer une étape `queue` idempotente ré-entrante depuis `USER_VALIDATED` et réordonner la route pour la rejouer.

## F2 — `requiresAutoRecharge` : flux mort, invariant `authorize()` cassé (S2, latent)

**fichier:ligne** `packages/wallet/src/wallet.service.ts:101-112`
```ts
if (wallet.autoRechargeEnabled) {
  return { authorized: true, source: WALLET,
           walletBalanceAfter: wallet.balance + wallet.autoRechargeAmount - cost, // solde PROJETÉ
           requiresAutoRecharge: true }
}
```
**preuve** `grep requiresAutoRecharge` sur `{apps,packages}/**/src` : produit en `:110`, **aucun lecteur**. `createListing` ([listing-engine.ts:75](packages/ai/src/listing-engine.ts:75)) ignore le flag, `reauthorize` aussi, la boucle Stripe ([stripe.ts:62-81](apps/api/src/routes/stripe.ts:62)) aussi. Le « TRIGGER_RECHARGE » de CLAUDE.md (WalletService étape 3) n'est **pas implémenté**. Conséquence si `autoRechargeEnabled=true` + `balance<cost` + 0 crédit gratuit : listing créé `AUTHORIZED/WALLET`, mobile reçoit `authorized:true` et un `walletBalanceAfter` incluant une recharge fantôme ; au `validate()`, `commit()` fait `updateMany where balance>=cost` → `count=0` → `InsufficientFundsError` **après** tout le parcours IA.
**réachabilité** Aujourd'hui inatteignable via API : aucun endpoint ne met `autoRechargeEnabled=true` (défaut `false`, cf. schema.prisma:35 ; CLAUDE.md « auto-recharge en lecture seule »). Devient actif dès qu'un endpoint de mutation (ou une écriture DB/admin) pose le flag.
**impact** Checkout débité-mais-échoué + solde affiché mensonger, sur un chemin argent documenté comme fonctionnel. Gate « autorisé » ↔ réalité rompu.
**fix** Soit implémenter réellement le déclenchement de recharge quand `requiresAutoRecharge`, soit retirer la branche 3 et le flag jusqu'à ce que la feature existe (YAGNI). Ne pas laisser `authorize()` promettre un solde non garanti.

## F3 — `editContent` en `PUBLISHED` : dérive prix local↔marketplace (S3)

**fichier:ligne** `packages/ai/src/listing-engine.ts:46-50` (`EDITABLE_STATUSES` inclut `PUBLISHED`) + `:201`
**preuve** Après `PUBLISHED`, `POST /:id/edit` modifie `titre/description/prixPublie` en base et recalcule `isPriceFlagged`, mais **aucune re-publication** vers le connecteur. La marketplace garde l'ancienne valeur. `LISTING_TRANSITIONS[PUBLISHED]=[EXPIRED]` : pas de retour en file.
**impact** Source de vérité locale diverge silencieusement de l'annonce en ligne sur un champ monétaire (prix), zéro reconciliation ni avertissement. Sur l'axe D (drift état local↔marketplace).
**réachabilité** Latent tant que la publication réelle n'est pas branchée (connecteurs = squelettes, credentials absents). Devient S2 dès publication live.
**fix** Exclure `PUBLISHED` de `EDITABLE_STATUSES`, ou router une édition post-publication vers une re-synchronisation connecteur explicite (update/retract+republish).

## F4 — `ChannelPublication` / `SalesChannel` morts-nés (S3)

**fichier:ligne** `schema.prisma:116-133` + migration `20260711191009_channel_publication_pivot`
**preuve** `grep ChannelPublication` → seulement schéma + migration. Zéro écriture/lecture applicative. `status` est un `String` « Zod SSOT » (`:120`) mais aucun Zod ne le valide, aucun code ne l'écrit. La migration (`:32-37`) reconnaît elle-même l'absence de backfill ; la vérité publication reste `publishedLbc/publishedVinted/lbcUrl/vintedUrl` ([schema.prisma:86-89](packages/db/prisma/schema.prisma:86)). Diff non commité (pivot posé 2026-07-11). L'ADR « à écrire pour ce lot » (`:37`) n'existe pas (`docs/adr/` s'arrête à ADR-008).
**impact** Table + enum + contraintes (dont `@@unique([channel,externalId])`) portées en prod à la prochaine migration sans aucun consommateur : dette figée, faux sentiment de capacité multi-canal. L'axe D « sync multi-marketplace » n'existe pas encore en logique — seulement en schéma.
**fix** Soit écrire l'ADR + le 1er consommateur (Publisher qui écrit `ChannelPublication`) dans le même lot, soit retirer la migration du prochain commit jusqu'à ce que le code l'utilise (installer le plus tard possible — règle ROLI/gouvernance).

## F5 — Triple nomenclature plateforme, SSOT éclaté (S3)

**fichier:ligne** `SalesChannel{EBAY,SHOPIFY,RAKUTEN}` ([schema.prisma:272](packages/db/prisma/schema.prisma:272)) · `enum Marketplace{LEBONCOIN,VINTED}` ([marketplace/src/types.ts:4](packages/marketplace/src/types.ts:4)) · `type MarketplaceId='VINTED'|'LEBONCOIN'` ([core/.../marketplace.ts:9](packages/core/src/types/marketplace.ts:9))
**preuve** Trois définitions disjointes de « la plateforme » : l'une en DB (canaux futurs eBay/Shopify/Rakuten), deux pour Vinted/LBC (une enum runtime `@flipsync/marketplace` + un union littéral `@flipsync/core` recopié à la main, commenté « miroir exact » sans garde de synchronisation). `core` ne peut importer `marketplace` (cycle), d'où la recopie.
**impact** SSOT plateforme non unique ; l'union `MarketplaceId` peut diverger de l'enum `Marketplace` sans erreur de compilation. Sur l'axe A (SSOT des types).
**fix** Déplacer l'enum plateforme de revente dans `@flipsync/core` (SSOT sans dépendance runtime), `@flipsync/marketplace` la ré-exporte. Clarifier la frontière `SalesChannel` (canaux storefront) vs marketplaces de revente dans un ADR.

## F6 — Transitions mission `EXPIRED` / `MISSION_FINALIZED` jamais émises (S3)

**fichier:ligne** `packages/core/src/types/negotiation.ts:127,171` ; consommateur `apps/api/src/services/negotiation.service.ts`
**preuve** `applyMissionEvent` supporte `EXPIRED→EXPIREE` et `MISSION_FINALIZED→MISSION_TERMINEE`, mais `grep` sur `apps/api/src` : aucun `type:'EXPIRED'` ni `MISSION_FINALIZED` émis (uniquement tests core). `NegotiationService` émet `SUSPENDED/RESUMED/STOPPED/SALE_CONFIRMED/…` mais jamais ces deux-là. `VENDU` reste donc terminal de fait (jamais → `MISSION_TERMINEE`), `EN_VENTE` n'expire jamais.
**impact** États `EXPIREE`/`MISSION_TERMINEE` inatteignables ; les branches d'affichage mobile correspondantes ([mission-dashboard.ts:61,70](apps/mobile/src/lib/mission-dashboard.ts:61)) sont du code mort. Flux incomplet (pas de bug de prod : gardé derrière `PREMIUM_MISSION_ENABLED` + canal simulé).
**fix** Émettre `MISSION_FINALIZED` après vente (clôture) et brancher un déclencheur d'expiration (cron/délai plateforme) — ou retirer les états tant que le cycle n'est pas complet.

## F7 — DTO API recopiés côté mobile au lieu de `@flipsync/core` (S3)

**fichier:ligne** `apps/mobile/src/services/api.ts:76` (`ApiListing`), `:133` (`ApiMission`), `:166` (`ApiWallet`)
**preuve** Le mobile déclare ses propres interfaces miroir du modèle Prisma renvoyé par l'API, alors que `@flipsync/core` est déjà une dépendance ([mobile/package.json:17](apps/mobile/package.json:17)). Viole la règle gouvernance explicite « ne jamais recopier un payload d'API côté front ; le contrat vit dans `packages/core` ». Cause racine : les routes renvoient le modèle Prisma brut (`return { listing }`), et `core` n'exporte pas de DTO wire correspondant.
**impact** Divergence silencieuse possible entre forme serveur et types mobile (aucune compilation croisée). Axe A.
**fix** Définir les DTO de réponse dans `@flipsync/core` (projection explicite, pas le modèle Prisma), les faire renvoyer par l'API et importer par le mobile. Supprimer les `Api*` recopiés.

## F8 — Commentaires + défauts « IA on-device » périmés (S3)

**fichier:ligne** `packages/ai/src/vision.ts:6` (« TOUJOURS on-device en production »), `:10` (`AI_INFERENCE_TIMEOUT_MS=15_000`), `:125` (défaut `model='moondream2'`) ; `routes/listing.ts:47-49` (« inférence ON-DEVICE (l'API ne fait jamais d'IA) »)
**preuve** Contredit frontalement le pivot IA serveur acté (ADR-003, CLAUDE.md Sprint 4) : l'inférence tourne côté API (Ollama qwen), `services-plugin` injecte 120 s ([services.ts:31,62](apps/api/src/plugins/services.ts:31)) et l'env impose `qwen2.5vl:3b`. Les défauts (`15s`, `moondream2`) sont donc systématiquement surchargés — morts mais trompeurs.
**impact** DX/maintenance : commentaires qui mentent au prochain lecteur, valeurs par défaut jamais exercées. Aucun impact runtime.
**fix** Aligner commentaires et défauts sur le pivot serveur (timeout 120 s, modèle qwen, retirer la mention on-device).

## F9 — Reset free-tier : dérive calendaire `setMonth` (S3)

**fichier:ligne** `packages/wallet/src/wallet.service.ts:137-138`
**preuve** `nextResetAt.setMonth(getMonth()+1)` sur le 31 d'un mois court déborde (31 janv → 3 mars). Sur des resets répétés, la date de renouvellement glisse.
**impact** Mineur : quelques jours de dérive du quota gratuit mensuel. Pas d'argent réel.
**fix** Ancrer au 1er du mois suivant (`setDate(1)` puis `setMonth(+1)`), ou normaliser via une lib date.

---

## Points solides vérifiés (tentatives de casse infructueuses)

| Cible | Verdict | Preuve |
|---|---|---|
| **Replay webhook Stripe** (H1) | **Sûr** | `recharge()` : lookup `stripeId` + contrainte `@unique` + catch `P2002` ([wallet.service.ts:166,211](packages/wallet/src/wallet.service.ts:166)). Double livraison ne crédite jamais 2×. Signature `constructEvent()` jamais skippée, même en dev ([stripe.ts:42](apps/api/src/routes/stripe.ts:42)) |
| **Refund rejouable** (H3) | **Sûr** | `refundWithin` : garde `alreadyRefunded` idempotente ([wallet.service.ts:315-318](packages/wallet/src/wallet.service.ts:315)) ; `commit` : un seul `DEBIT` par listing ([:238-241](packages/wallet/src/wallet.service.ts:238)) |
| **IDOR** (H4) | **Sûr** | Toutes les routes listing/mission/notification filtrent par `userId` (`findFirst {id,userId}`) ; job IA vérifie `job.userId!==req.userId` → 404 ([ai.ts:90](apps/api/src/routes/ai.ts:90)) ; pas de fuite d'existence (404 uniforme) |
| **Débit hors transaction** | **Sûr** | `validate`/`failPublish`/`refund`/`commit` tous dans `$transaction`, verrou optimiste `updateMany where status=lu` ([listing-engine.ts:284-288](packages/ai/src/listing-engine.ts:284)) |
| **Secrets committés** (Axe F) | **Sûr** | `git ls-files` : seul `.env.example` tracké ; hits `sk_test/whsec` = placeholders docker-compose + fixtures test + check de préfixe health. Aucun secret réel |
| **Mock marketplace en prod** (H7) | **Sûr** | `mockEnabled()` exige `NODE_ENV!=='production'` ([marketplace-auth.service.ts:47](apps/api/src/services/marketplace-auth.service.ts:47)) ; dev-token/dev-sessions/dev-actions/simulate tous gardés `NODE_ENV!=='production'` + revérifiés par route |
| **Magic link** (Axe F) | **Sûr** | Token brut jamais stocké (sha256), usage unique atomique (`updateMany consumedAt=null`), TTL, anti-énumération (200 uniforme), rate-limit 5/min partagé `/auth/*` ([magic-link.service.ts:78](apps/api/src/services/magic-link.service.ts:78)) |
| **Upload photos** (Axe F) | **Sûr** | sha256 recalculé serveur, rejet du lot entier si écart, quota idempotent, écriture nommée par hash (pas de path traversal — nom = `[a-f0-9]{64}.jpg`) ([listing.ts:249-253](apps/api/src/routes/listing.ts:249)) |
| **Validation frontière statuts String-Zod** (H6) | **Sûr** | `mission POST` et `simulate` valident via `z.nativeEnum`/`discriminatedUnion` avant persistance ([mission.ts:6-45](apps/api/src/routes/mission.ts:6)) ; enum core = généré depuis Prisma (SSOT) |
| **Type-safety** (Axe B) | **Propre** | `grep ': any'/'as any'` → 0 occurrence dans `src`. `strict:true` + `noUncheckedIndexedAccess` ([tsconfig.base.json:8-9](tsconfig.base.json:8)). Casts `as unknown as` limités aux ponts enum Prisma↔core (même donnée générée) |

## Écarts de cadrage confirmés (anti-F1)

- **`UnifiedListing` union `fixed|auction`** : inexistant (grep 0). L'Axe B a porté sur les unions réelles (`PublishResult`, `NegotiationAction`, `IncomingMessage`) — toutes exhaustives (switch couvrant, `discriminatedUnion` au boundary).
- **Boundaries eBay/Shopify/Rakuten** : DB-only, zéro code (cf. F4). Les boundaries API effectives auditées : Stripe, Ollama, Vinted/LBC (squelettes), Expo Push, Email.
- **Sync/idempotence multi-marketplace** : non implémentée — un listing publie sur UNE marketplace (`publishBody` = un seul `marketplace`), aucun delist/retract, aucun « vendu ailleurs ». Risque futur, pas bug présent.

---

**STOP — fin Phase 1.** Attente `[GO]` (ou `[GO fix direct]`) pour Phase 2 remédiation. Ordre de remédiation proposé : F1 → F2 (argent) puis F4/F5 (dette schéma non commitée, à trancher avant le prochain commit du pivot) puis F3/F6/F7/F8/F9.
