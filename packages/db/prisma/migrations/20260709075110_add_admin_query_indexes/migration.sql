-- AlterTable
ALTER TABLE "UserWallet" ALTER COLUMN "freeListingsResetAt" SET DEFAULT NOW() + INTERVAL '1 month';

-- CreateIndex
CREATE INDEX "DraftJob_status_updatedAt_idx" ON "DraftJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Listing_status_updatedAt_idx" ON "Listing"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_type_createdAt_idx" ON "WalletTransaction"("type", "createdAt");
