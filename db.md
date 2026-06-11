# Base de données FlipSync

## Modèles principaux
- User : id, email
- UserWallet : balance(Int centimes), freeListingsRemaining, autoRecharge*
- WalletTransaction : type(CREDIT/DEBIT/BONUS/REFUND), amount(Int centimes)
- Listing : tier, status(ListingStatus), cost(Int), prix*(Int centimes)
- ListingPhoto : url, sha256, order

## Enums Prisma
ListingTier     : SIMPLE | OPTIMIZED | PREMIUM
ListingStatus   : PENDING_AUTH | AUTHORIZED | AI_PROCESSING | AI_FAILED |
                  DRAFT_READY | USER_VALIDATED | USER_CANCELLED |
                  QUEUED | PUBLISH_FAILED | PUBLISHED | EXPIRED
PaymentSource   : FREE_CREDIT | WALLET | BLOCKED
TransactionType : CREDIT | DEBIT | BONUS | REFUND
ItemCondition   : neuf | tres_bon | bon | correct
CancelActor     : USER | SYSTEM

## Règle financière
Tous les champs monétaires = Int (centimes).
Aucun Float en base de données pour l'argent.

## Migrations
npx prisma db push     (dev)
npx prisma migrate dev (prod-ready)
