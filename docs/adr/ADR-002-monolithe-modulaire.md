# ADR-002 — Monolithe modulaire sur Turborepo

- **Statut :** Accepté
- **Date :** 2026-01-01 (décision fondatrice, antérieure au suivi ADR)
- **Contexte :** FlipSync est développé et exploité par un fondateur solo. Une architecture
  distribuée (microservices) a un coût d'exploitation que le projet ne peut pas absorber.
- **Décision :** Un seul déployable API (`apps/api`), découpage en `packages/*` par domaine
  (core, db, ai, wallet, marketplace) avec des frontières de code nettes, pas de découpage réseau.
- **Conséquences :** Pas de latence inter-service, pas de panne partielle distribuée. Toute
  proposition de microservice/worker séparé doit démontrer une saturation réelle avant d'être
  envisagée (cf. ROADMAP_2_6_MONTHS.md Item 0).
