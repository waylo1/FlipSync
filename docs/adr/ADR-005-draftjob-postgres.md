# ADR-005 — Jobs IA asynchrones persistés en Postgres

- **Statut :** Accepté
- **Date :** 2026-07-07
- **Contexte :** L'inférence CPU dev prend 70–90 s. Une requête HTTP synchrone coupée par un OS
  mobile agressif (MIUI) en arrière-plan perdait le brouillon. Un stockage en mémoire (Map) perdait
  aussi les jobs en cours à chaque redémarrage serveur.
- **Décision :** `POST /ai/draft/start` crée un job persisté (table `DraftJob`, Postgres) et
  répond immédiatement (202). Le mobile poll `GET /ai/draft/:jobId`. Cycle de vie découplé du
  modèle `Listing` — aucun débit wallet ni transition `ListingStatus` dans ce flux.
- **Conséquences :** Un redémarrage serveur ne perd plus les jobs en cours. Pas de file externe
  (Redis) tant qu'un seul type de job asynchrone existe (cf. ROADMAP §2.3).
