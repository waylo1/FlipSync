-- AlterTable (artefact dbgenerated — Prisma re-déclare l'expression par défaut)
ALTER TABLE "UserWallet" ALTER COLUMN "freeListingsResetAt" SET DEFAULT NOW() + INTERVAL '1 month';

-- CreateIndex — idempotence webhook Stripe : un event = max un crédit
CREATE UNIQUE INDEX "WalletTransaction_stripeId_key" ON "WalletTransaction"("stripeId");
