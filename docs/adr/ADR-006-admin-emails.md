# ADR-006 — Autorisation admin par liste blanche d'emails

- **Statut :** Accepté
- **Date :** 2026-07-08
- **Contexte :** La console Mission Control (`/admin/*`) a besoin d'une garde d'accès. Un système
  de rôles en base (migration Prisma, table permissions) serait disproportionné pour un seul
  administrateur (le fondateur).
- **Décision :** `ADMIN_EMAILS` (variable d'env, CSV) contient la liste blanche. `requireAdmin`
  réutilise le JWT existant (`{ sub: userId }`), lookup DB de l'email, fail-closed si absent/vide.
- **Conséquences :** Zéro migration pour une console interne. Si FlipSync a un jour plusieurs
  administrateurs avec des permissions différenciées, ceci devient un nouvel ADR (pas une
  extension silencieuse de celui-ci).
