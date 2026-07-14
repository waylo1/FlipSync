-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('ACTIVE', 'SOLD', 'WITHDRAWN', 'WITHDRAW_FAILED');

-- AlterTable
ALTER TABLE "ListingPublication" ADD COLUMN "status" "PublicationStatus" NOT NULL DEFAULT 'ACTIVE';
