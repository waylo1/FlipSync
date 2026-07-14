-- CreateEnum
CREATE TYPE "ListingTier" AS ENUM ('SIMPLE', 'OPTIMIZED', 'PREMIUM');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('PENDING_AUTH', 'AUTHORIZED', 'AI_PROCESSING', 'AI_FAILED', 'DRAFT_READY', 'USER_VALIDATED', 'USER_CANCELLED', 'QUEUED', 'PUBLISH_FAILED', 'PUBLISHED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('FREE_CREDIT', 'WALLET', 'BLOCKED', 'STRIPE_RECHARGE', 'BONUS');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT', 'BONUS', 'REFUND');

-- CreateEnum
CREATE TYPE "DraftJobStatus" AS ENUM ('RUNNING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('LEBONCOIN', 'VINTED', 'EBAY', 'SHOPIFY');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('neuf', 'tres_bon', 'bon', 'correct');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('BROUILLON_MANDAT', 'EN_VENTE', 'NEGOCIATION_ACTIVE', 'EN_ATTENTE_VALIDATION', 'VENDU', 'MISSION_TERMINEE', 'SUSPENDUE', 'ARRETEE', 'EXPIREE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "freeListingsRemaining" INTEGER NOT NULL DEFAULT 3,
    "freeListingsResetAt" TIMESTAMP(3) NOT NULL DEFAULT NOW() + INTERVAL '1 month',
    "autoRechargeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoRechargeThreshold" INTEGER NOT NULL DEFAULT 100,
    "autoRechargeAmount" INTEGER NOT NULL DEFAULT 1000,
    "lifetimeRecharged" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "listingId" TEXT,
    "stripeId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "ListingTier" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'PENDING_AUTH',
    "paymentSource" "PaymentSource" NOT NULL,
    "cost" INTEGER NOT NULL,
    "titre" TEXT,
    "description" TEXT,
    "categorieLbc" TEXT,
    "categorieVinted" TEXT,
    "etat" "ItemCondition",
    "prixPlancher" INTEGER,
    "prixHaut" INTEGER,
    "prixPublie" INTEGER,
    "marque" TEXT,
    "confidence" DOUBLE PRECISION,
    "publishedLbc" BOOLEAN NOT NULL DEFAULT false,
    "publishedVinted" BOOLEAN NOT NULL DEFAULT false,
    "lbcUrl" TEXT,
    "vintedUrl" TEXT,
    "isPriceFlagged" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPublication" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingPublication_pkey" PRIMARY KEY ("id")
);

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
    "soldAt" TIMESTAMP(3),
    "activeBuyerCount" INTEGER NOT NULL DEFAULT 0,
    "bestOfferAmount" INTEGER,
    "pendingReason" TEXT,
    "pendingOfferAmount" INTEGER,
    "pendingBuyerName" TEXT,
    "soldAmount" INTEGER,
    "preSuspendStatus" "MissionStatus",
    "lastNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "MagicLinkToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPhoto" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevSession" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "platform" TEXT,
    "appVersion" TEXT,

    CONSTRAINT "DevSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "DevEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserWallet_userId_key" ON "UserWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_stripeId_key" ON "WalletTransaction"("stripeId");

-- CreateIndex
CREATE INDEX "WalletTransaction_type_createdAt_idx" ON "WalletTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Listing_status_updatedAt_idx" ON "Listing"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingPublication_listingId_marketplace_key" ON "ListingPublication"("listingId", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "Mission_listingId_key" ON "Mission"("listingId");

-- CreateIndex
CREATE INDEX "Mission_userId_status_idx" ON "Mission"("userId", "status");

-- CreateIndex
CREATE INDEX "MissionEvent_missionId_createdAt_idx" ON "MissionEvent"("missionId", "createdAt");

-- CreateIndex
CREATE INDEX "DraftJob_userId_idx" ON "DraftJob"("userId");

-- CreateIndex
CREATE INDEX "DraftJob_createdAt_idx" ON "DraftJob"("createdAt");

-- CreateIndex
CREATE INDEX "DraftJob_status_updatedAt_idx" ON "DraftJob"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLinkToken_tokenHash_key" ON "MagicLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLinkToken_email_idx" ON "MagicLinkToken"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE INDEX "DevSession_startedAt_idx" ON "DevSession"("startedAt");

-- CreateIndex
CREATE INDEX "DevEvent_sessionId_ts_idx" ON "DevEvent"("sessionId", "ts");

-- AddForeignKey
ALTER TABLE "UserWallet" ADD CONSTRAINT "UserWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "UserWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPublication" ADD CONSTRAINT "ListingPublication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionEvent" ADD CONSTRAINT "MissionEvent_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftJob" ADD CONSTRAINT "DraftJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPhoto" ADD CONSTRAINT "ListingPhoto_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevEvent" ADD CONSTRAINT "DevEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DevSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

