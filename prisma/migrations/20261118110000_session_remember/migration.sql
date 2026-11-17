-- AlterTable
ALTER TABLE "Session" ADD COLUMN "absoluteExpiresAt" DATETIME;
ALTER TABLE "Session" ADD COLUMN "browserKeyHash" TEXT;

