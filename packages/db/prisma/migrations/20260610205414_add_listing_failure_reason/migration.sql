-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "failureReason" TEXT;

-- AlterTable
ALTER TABLE "UserWallet" ALTER COLUMN "freeListingsResetAt" SET DEFAULT NOW() + INTERVAL '1 month';
