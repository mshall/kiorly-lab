-- CreateEnum
CREATE TYPE "IntegrationMode" AS ENUM ('STANDALONE', 'INTEGRATED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "defaultLocale" TEXT NOT NULL DEFAULT 'ar',
ADD COLUMN     "integrationMode" "IntegrationMode" NOT NULL DEFAULT 'INTEGRATED';

