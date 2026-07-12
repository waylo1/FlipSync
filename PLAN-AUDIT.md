# PLAN-AUDIT — FlipSync (GATE-0)

> Exécution mono-thread séquentielle, zéro subagent. Phase 1 = READ-ONLY.
> Sortie : `FLIPSYNC-AUDIT.md`. Finding = `{id, sévérité, fichier:ligne, preuve, impact, fix}`.
> S1 bloquant / S2 majeur / S3 mineur. Budget contexte serré → STOP + rapport partiel.

## Recalibrage du cadre (cf. CODE-MAP §10)

| Hypothèse du cadre | Verdict code | Conséquence |
|---|---|---|
| `UnifiedListing fixed\|auction` | inexistant | Axe B → unions réelles : `PublishResult`, statuts String-Zod (`ChannelPublication.status`, `Mission.pendingReason`, `MissionEvent.kind`), enums générés |
| Boundaries eBay/Shopify/Rakuten | DB-only, zéro code | Axe E → boundaries effectives : Stripe, Ollama, Vinted/LBC, Expo Push, Email. Axe A absorbe la double vérité `SalesChannel` vs `Marketplace` |
| `@flipsync/shared` | c'est `@flipsync/core` | Axe A inchangé sur le fond |

## Ordre d'attaque — 6 passes séquentielles (risque décroissant)

### P1 — Argent réel (Axes D-partiel, H) — priorité absolue
Fichiers : `packages/wallet/src/wallet.service.ts` (+ tests), `apps/api/src/routes/wallet.ts`, `routes/stripe.ts`, `routes/listing.ts` (authorize/commit/refund aux transitions), `packages/ai/src/listing-engine.ts`, `transitions.ts`.
Cherché : débit hors `$transaction`, double remboursement (AI_FAILED puis retry), commit avant USER_VALIDATED, race authorize concurrent (2 listings, 1 solde), idempotence webhook Stripe réellement atomique (`stripeId @unique` : gestion du P2002 ?), TRIGGER_RECHARGE non atomique, bonus fidélité rejouable, free tier reset.

### P2 — State machines & publication (Axes C, D, H)
Fichiers : `services/publication.service.ts`, `routes/listing.ts` (publish), `packages/marketplace/src/client.ts`, `connectors/*.ts`, `services/mission.service.ts`, `negotiation.service.ts` (+ tests flow).
Cherché : transitions illégales non bloquées, publish partiel LBC ok/Vinted fail → état + remboursement (double colonne `publishedLbc/publishedVinted`), idempotence re-publish (double annonce externe), PUBLISH_FAILED sans failureReason, mission SUSPENDUE/RESUMED (restauration `preSuspendStatus`), dérive compteurs dénormalisés `Mission.activeBuyerCount/bestOfferAmount` vs `MissionEvent`, gate `PREMIUM_MISSION_ENABLED` contournable.

### P3 — Boundaries externes (Axe E)
Fichiers : `connectors/vinted.ts`, `leboncoin.ts`, `mock.ts`, `services/marketplace-auth.service.ts`, `packages/ai/src/vision.ts`, `services/notification.service.ts`, `email.service.ts`.
Cherché : réponses externes non validées (trust payload Ollama/marketplace/Expo), taxonomy transient vs permanent → retry/remboursement erroné, expiry tokens (`*_TOKEN_EXPIRES_AT` validé à l'usage — trous ?), mock activable en prod, timeouts/backoff absents.

### P4 — Red team sécu (Axe F)
Fichiers : `plugins/auth.ts`, `routes/auth.ts`, `magic-link.service.ts`, `routes/admin.ts`, `routes/dev-sessions.ts`, `routes/notification.ts`, uploads (`routes/listing.ts`, `app.ts:50-58`), `apps/web/src/services/api.ts`.
Cherché : secrets committés (grep clés/tokens sur tout le repo, `.env` ignoré ?), IDOR (listingId/missionId/jobId d'un autre user), dev-token/dev-sessions joignables en prod, magic link : brute-force/énumération/TTL/single-use effectifs, path traversal uploads + sha256 réellement vérifié, PII dans logs/events (`meta` sans PII promis), webhook Stripe : skip signature en dev ?, admin console token inliné (connu — vérifier non-déployé), rate limiting réel.

### P5 — SSOT & type-safety (Axes A, B)
Fichiers : `packages/core/src/index.ts`, `types/*.ts`, `generated/enums.ts` vs `schema.prisma`, `apps/mobile/src/services/api.ts`, `apps/web/src/services/api.ts`, tsconfigs.
Cherché : payloads recopiés côté mobile/web (anti-SSOT), enums TS ↔ Prisma dérive (script generate à jour ?), `any`/`as` non prouvés (grep), strict partout, statuts String-Zod : validation frontière réellement présente pour `Mission.posture/objectif/…`, exhaustivité switch (`never`) sur unions consommées, drift `MarketplaceId` (core) vs `Marketplace` (marketplace) vs `SalesChannel` (db).

### P6 — Dead code & hygiène (Axe G)
Cherché : `ChannelPublication` morte-née (assumé Lot 1 — vérifier ADR promis), routes/exports orphelins, `llama.rn` résiduel mobile, `front end.txt` étranger, patches/ justifié, flows morts (écrans mobile non routés), naming FR/EN incohérent aux frontières.

## Hypothèses de risque à falsifier (priorité)

| # | Hypothèse | Où |
|---|---|---|
| H1 | Un même événement Stripe rejoué crédite 2× (P2002 non rattrapé ≠ idempotence) | stripe.ts |
| H2 | Publish partiel multi-plateforme laisse un état incohérent + remboursement total/partiel faux | publication.service |
| H3 | Refund automatique rejouable (retry publish après PUBLISH_FAILED déjà remboursé) | listing-engine / publication |
| H4 | IDOR sur au moins une route (draft job, mission, photo) | routes/* |
| H5 | Compteurs dénormalisés Mission dérivent des MissionEvent (race poll/notify) | negotiation.service |
| H6 | Statuts String-Zod non validés à TOUTES les frontières (écriture directe DB) | mission/negotiation |
| H7 | Le canal simulé peut fuiter en prod malgré le flag (mock, dev-sessions, dev-token) | env gates |
| H8 | Enums générés désynchronisés du schema modifié non commité (SalesChannel absent de core ?) | generated/enums.ts |

## Règles d'exécution Phase 1

- Lecture par passe, findings notés au fil de l'eau, aucun fix appliqué.
- Chaque finding : preuve reproductible (extrait code, commande grep, scénario pas-à-pas).
- Pas de finding « de principe » : si non ancré `fichier:ligne`, il n'existe pas.
- Fin de passe → checkpoint interne ; fin de P6 → `FLIPSYNC-AUDIT.md` + table triée par sévérité → **STOP, attente [GO]**.
