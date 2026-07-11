-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('EBAY', 'SHOPIFY', 'RAKUTEN');

-- CreateTable
CREATE TABLE "ChannelPublication" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "status" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT,
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelPublication_channel_status_idx" ON "ChannelPublication"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPublication_listingId_channel_key" ON "ChannelPublication"("listingId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPublication_channel_externalId_key" ON "ChannelPublication"("channel", "externalId");

-- AddForeignKey
ALTER TABLE "ChannelPublication" ADD CONSTRAINT "ChannelPublication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pas de backfill ici : SalesChannel (EBAY/SHOPIFY/RAKUTEN) ne couvre pas encore
-- VINTED/LEBONCOIN (Phase 2 agrégateur B2B). Retagger les publications Vinted/LBC
-- historiques sous un canal EBAY/SHOPIFY serait une corruption de données. Le
-- backfill des colonnes legacy (publishedLbc/vintedUrl/lbcUrl) aura lieu quand
-- VINTED/LEBONCOIN rejoindront l'enum ; ces colonnes restent la source de vérité
-- jusqu'à ce moment (cf. ADR à écrire pour ce lot).
