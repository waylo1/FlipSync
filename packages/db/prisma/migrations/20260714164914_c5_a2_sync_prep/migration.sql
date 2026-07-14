-- AlterTable
ALTER TABLE "ListingPublication" ADD COLUMN     "epoch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "externalMeta" JSONB,
ADD COLUMN     "retractStartedAt" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChannelEvent" (
    "id" TEXT NOT NULL,
    "channel" "Marketplace" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleFact" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "channel" "Marketplace" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "eventKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelEvent_channel_eventKey_key" ON "ChannelEvent"("channel", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "SaleFact_listingId_key" ON "SaleFact"("listingId");

-- AddForeignKey
ALTER TABLE "SaleFact" ADD CONSTRAINT "SaleFact_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
