-- CreateEnum
CREATE TYPE "SafetyAlertKind" AS ENUM ('NO_ANSWER', 'SOS', 'UNSAFE_ABORT');

-- AlterEnum
ALTER TYPE "CollectionType" ADD VALUE 'NURSE_VISIT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "HomeCollectionStatus" ADD VALUE 'ARRIVED';
ALTER TYPE "HomeCollectionStatus" ADD VALUE 'ABORTED_UNSAFE';

-- AlterEnum
ALTER TYPE "NotificationPurpose" ADD VALUE 'SAFETY_ALERT';

-- AlterEnum
ALTER TYPE "OrderSource" ADD VALUE 'KIORLY_NURSE';

-- AlterEnum
ALTER TYPE "ReleaseChannel" ADD VALUE 'KIORLY_NURSE_IMPORT';

-- AlterTable
ALTER TABLE "HomeCollection" ADD COLUMN     "abortReason" TEXT,
ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "districtId" TEXT,
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "history" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "onMyWayAt" TIMESTAMP(3),
ADD COLUMN     "safetyState" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Lab" ADD COLUMN     "coverageDistricts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "maxTravelMinutes" INTEGER,
ADD COLUMN     "startDistrictId" TEXT,
ADD COLUMN     "travelMatrix" JSONB;

-- AlterTable
ALTER TABLE "Specimen" ADD COLUMN     "collectedByRef" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "homeBufferAfterMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "homeBufferBeforeMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "homeDailyCap" INTEGER,
ADD COLUMN     "safetyContactName" TEXT,
ADD COLUMN     "safetyContactPhone" TEXT;

-- CreateTable
CREATE TABLE "NurseCollection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "nurseVisitRef" TEXT NOT NULL,
    "collectorRef" TEXT NOT NULL,
    "collectorName" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "handedOverAt" TIMESTAMP(3),
    "temperatureC" DECIMAL(5,2),
    "consentTokenHash" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NurseCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyAlert" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "homeCollectionId" TEXT NOT NULL,
    "kind" "SafetyAlertKind" NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "withinSla" BOOLEAN,
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "lastGeostamp" JSONB,

    CONSTRAINT "SafetyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NurseCollection_orderId_key" ON "NurseCollection"("orderId");

-- CreateIndex
CREATE INDEX "NurseCollection_orgId_collectedAt_idx" ON "NurseCollection"("orgId", "collectedAt");

-- CreateIndex
CREATE INDEX "SafetyAlert_orgId_raisedAt_idx" ON "SafetyAlert"("orgId", "raisedAt");

-- CreateIndex
CREATE INDEX "SafetyAlert_homeCollectionId_idx" ON "SafetyAlert"("homeCollectionId");

-- AddForeignKey
ALTER TABLE "NurseCollection" ADD CONSTRAINT "NurseCollection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAlert" ADD CONSTRAINT "SafetyAlert_homeCollectionId_fkey" FOREIGN KEY ("homeCollectionId") REFERENCES "HomeCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
