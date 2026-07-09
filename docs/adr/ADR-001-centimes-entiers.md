# ADR-001 — Valeurs monétaires en centimes entiers

- **Statut :** Accepté
- **Date :** 2026-01-01 (décision fondatrice, antérieure au suivi ADR)
- **Contexte :** Les montants financiers (wallet, prix, coûts) doivent être stockés et manipulés
  sans erreur d'arrondi flottant. Stripe attend nativement des centimes.
- **Décision :** Toute valeur monétaire est un `Int` en centimes (`1000` = 10,00 €). Jamais de
  `Float` pour l'argent. Helpers `centsToEur`/`eurToCents` (`packages/core`).
- **Conséquences :** Aucune conversion flottante possible sur le chemin financier. `confidence`
  (score IA 0–1) reste `Float` intentionnellement — ce n'est pas de l'argent.
