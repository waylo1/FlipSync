-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "activeBuyerCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bestOfferAmount" INTEGER,
ADD COLUMN     "pendingBuyerName" TEXT,
ADD COLUMN     "pendingOfferAmount" INTEGER,
ADD COLUMN     "pendingReason" TEXT,
ADD COLUMN     "preSuspendStatus" "MissionStatus",
ADD COLUMN     "soldAmount" INTEGER,
ADD COLUMN     "soldAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MissionEvent" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "amount" INTEGER,
    "buyerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionEvent_missionId_createdAt_idx" ON "MissionEvent"("missionId", "createdAt");

-- AddForeignKey
ALTER TABLE "MissionEvent" ADD CONSTRAINT "MissionEvent_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
