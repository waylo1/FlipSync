# ADR-008 — Fournisseur d'inférence IA en production

- **Statut :** Ouvert
- **Date :** —
- **Contexte :** Dev = Ollama qwen2.5vl:3b (CPU, 70–90 s/photo froide). Prod non décidée entre
  API hébergée (ex. Claude Haiku 4.5, ~0,5 c€/annonce) et GPU loué + Ollama (~30–80 €/mois fixes).
- **Décision :** Non tranchée. Recommandation CTO (ROADMAP_2_6_MONTHS.md Item 0) : démarrer en
  API hébergée — charge d'exploitation quasi nulle pour un solo, coût négligeable au volume de
  démarrage. Rebasculer vers un GPU seulement si le coût/appel mesuré le justifie.
- **Conséquences :** Le contrat `VisionBackend` (`packages/ai`) doit rester agnostique du
  fournisseur pour que cette décision reste réversible sans refonte.
