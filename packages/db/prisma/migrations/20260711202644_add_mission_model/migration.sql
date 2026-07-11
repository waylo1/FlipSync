-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('BROUILLON_MANDAT', 'EN_VENTE', 'NEGOCIATION_ACTIVE', 'EN_ATTENTE_VALIDATION', 'VENDU', 'MISSION_TERMINEE', 'SUSPENDUE', 'ARRETEE', 'EXPIREE');

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MissionStatus" NOT NULL DEFAULT 'BROUILLON_MANDAT',
    "listingId" TEXT NOT NULL,
    "posture" TEXT NOT NULL,
    "objectif" TEXT NOT NULL,
    "prixAffiche" INTEGER NOT NULL,
    "prixMini" INTEGER NOT NULL,
    "livraison" TEXT NOT NULL,
    "casComplexes" TEXT NOT NULL,
    "autoAdjugeAuDessusDuMini" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enVenteAt" TIMESTAMP(3),

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mission_listingId_key" ON "Mission"("listingId");

-- CreateIndex
CREATE INDEX "Mission_userId_status_idx" ON "Mission"("userId", "status");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

