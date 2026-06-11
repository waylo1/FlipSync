-- CreateEnum
CREATE TYPE "ListingTier" AS ENUM ('SIMPLE', 'OPTIMIZED', 'PREMIUM');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('PENDING_AUTH', 'AUTHORIZED', 'AI_PROCESSING', 'AI_FAILED', 'DRAFT_READY', 'USER_VALIDATED', 'USER_CANCELLED', 'QUEUED', 'PUBLISH_FAILED', 'PUBLISHED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('FREE_CREDIT', 'WALLET', 'BLOCKED', 'STRIPE_RECHARGE', 'BONUS');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT', 'BONUS', 'REFUND');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('neuf', 'tres_bon', 'bon', 'correct');

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserWallet_userId_key" ON "UserWallet"("userId");

-- AddForeignKey
ALTER TABLE "UserWallet" ADD CONSTRAINT "UserWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "UserWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPhoto" ADD CONSTRAINT "ListingPhoto_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
