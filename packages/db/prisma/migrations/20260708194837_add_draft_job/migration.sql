-- CreateEnum
CREATE TYPE "DraftJobStatus" AS ENUM ('RUNNING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "UserWallet" ALTER COLUMN "freeListingsResetAt" SET DEFAULT NOW() + INTERVAL '1 month';

-- CreateTable
CREATE TABLE "DraftJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DraftJobStatus" NOT NULL DEFAULT 'RUNNING',
    "draft" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DraftJob_userId_idx" ON "DraftJob"("userId");

-- CreateIndex
CREATE INDEX "DraftJob_createdAt_idx" ON "DraftJob"("createdAt");

-- AddForeignKey
ALTER TABLE "DraftJob" ADD CONSTRAINT "DraftJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
