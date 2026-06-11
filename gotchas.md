# Gotchas FlipSync

## Prisma
- TOUJOURS prisma.$transaction() pour opérations wallet
- freeListingsResetAt : reset via cron, pas en app
- onDelete: Cascade sur ListingPhoto → Listing

## Expo / React Native
- expo prebuild OBLIGATOIRE avant run:android (modules natifs llama.rn)
- llama.rn : modèle chargé au démarrage app, pas à la demande
- MMKV : ne pas utiliser AsyncStorage, trop lent

## Android
- AccessibilityService = activation manuelle user dans Paramètres
- Label service neutre : fr.flipsync.InputAssistant
- Vinted/LBC peuvent détecter le service actif → suspension 30s

## iOS
- Keyboard Extension = sandbox App Group obligatoire
- Pas d'accès réseau dans l'extension par défaut
- Tester sur device réel, pas simulateur

## Stripe
- constructEvent() pour valider webhook — ne jamais skip
- Centimes nativement dans Stripe — pas de conversion
- Idempotency key sur chaque PaymentIntent

## Sécurité
- JWT payload : { sub: userId } uniquement
- Ne jamais retourner le solde wallet dans une liste publique
