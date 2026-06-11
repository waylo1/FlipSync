# Règles absolues FlipSync

## Finance
- Int centimes UNIQUEMENT pour balance, amount, cost, prix*
- Jamais Float sur un champ monétaire
- centsToEur() uniquement côté UI

## Code
- TypeScript strict, zéro any
- Enums Prisma = Enums TS (miroir exact)
- prisma.$transaction() pour tout débit/crédit wallet

## Sécurité
- JWT sur toutes routes sauf /health
- Ne jamais logger de données financières en clair
- sha256 sur toutes les photos listing

## IA
- Inférence toujours on-device
- Jamais d'appel API externe pour l'analyse vision
- Timeout modèle : 15s max, sinon AI_FAILED

## Anti-détection
- dispatchKeyEvent() uniquement, jamais paste()
- Jitter gaussien obligatoire entre chaque champ
