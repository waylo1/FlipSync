# ADR-003 — Inférence IA côté serveur (abandon on-device)

- **Statut :** Accepté
- **Date :** 2026-07-07
- **Contexte :** Moondream2 on-device (llama.rn) voit l'image mais ne sait produire ni JSON
  structuré ni français correct (validé sur device : sortie = caption anglaise libre).
- **Décision :** L'inférence tourne côté API (`POST /ai/draft/start`, Ollama qwen2.5vl:3b en dev).
  Le mobile ne parle qu'à l'API FlipSync, jamais à un modèle embarqué ni à un tiers.
- **Conséquences :** Fichiers mobile de vision supprimés (~1,8 Go de modèles en moins sur device).
  Le choix du backend d'inférence prod reste ouvert (cf. ADR-008).
