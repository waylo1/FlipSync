# ADR-004 — Publication via APIs partenaires officielles uniquement

- **Statut :** Accepté
- **Date :** 2026-01-01 (pivot Sprint 3)
- **Contexte :** L'automatisation d'UI (stealth Android, AccessibilityService) pour publier sur
  Leboncoin/Vinted est fragile et non conforme aux conditions d'utilisation des plateformes.
- **Décision :** Publication uniquement via connecteurs officiels (Vinted Integrations/Pro,
  Leboncoin Partenaire), logique 100 % serveur (`@flipsync/marketplace`). Modules
  stealth/AccessibilityService supprimés intégralement.
- **Conséquences :** Publication bloquée tant que les credentials partenaires ne sont pas obtenus
  (état `MISSING`, attendu et assumé). Aucun contournement UI ne sera réintroduit.
