-- CreateEnum
CREATE TYPE "StorageKind" AS ENUM ('FRIDGE', 'FREEZER_MINUS20', 'FREEZER_MINUS80', 'ROOM_TEMP', 'RACK');

-- CreateEnum
CREATE TYPE "RecollectionStatus" AS ENUM ('REQUESTED', 'NOTIFIED', 'COLLECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ManifestKind" AS ENUM ('INTER_BRANCH', 'SEND_OUT');

-- CreateEnum
CREATE TYPE "ManifestStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'RECEIVED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RejectionReason" ADD VALUE 'LIPAEMIC';
ALTER TYPE "RejectionReason" ADD VALUE 'LEAKED';
ALTER TYPE "RejectionReason" ADD VALUE 'UNLABELLED';
ALTER TYPE "RejectionReason" ADD VALUE 'TEMPERATURE_EXCURSION';
ALTER TYPE "RejectionReason" ADD VALUE 'STABILITY_EXCEEDED';

-- AlterTable
ALTER TABLE "Specimen" ADD COLUMN     "retentionUntil" TIMESTAMP(3),
ADD COLUMN     "volumeMl" DECIMAL(8,2);

-- CreateTable
CREATE TABLE "StorageUnit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StorageKind" NOT NULL DEFAULT 'FRIDGE',
    "rows" INTEGER NOT NULL DEFAULT 8,
    "cols" INTEGER NOT NULL DEFAULT 12,
    "tempMinC" DECIMAL(5,1),
    "tempMaxC" DECIMAL(5,1),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageAssignment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "specimenId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,

    CONSTRAINT "StorageAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "specimenType" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,

    CONSTRAINT "RetentionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecollectionRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "rejectedSpecimenId" TEXT NOT NULL,
    "newSpecimenId" TEXT,
    "reason" "RejectionReason" NOT NULL,
    "note" TEXT,
    "status" "RecollectionStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedBy" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecollectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Courier" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Courier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportManifest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "ManifestKind" NOT NULL,
    "status" "ManifestStatus" NOT NULL DEFAULT 'DRAFT',
    "fromLabId" TEXT NOT NULL,
    "toLabId" TEXT,
    "destinationName" TEXT,
    "courierId" TEXT,
    "courierName" TEXT,
    "courierPhone" TEXT,
    "trackingRef" TEXT NOT NULL,
    "temperatureC" DECIMAL(5,1),
    "note" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "receivedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManifestItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "specimenId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PACKED',
    "receivedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ManifestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "location" TEXT,
    "note" TEXT,
    "temperatureC" DECIMAL(5,1),
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorageUnit_orgId_idx" ON "StorageUnit"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageUnit_labId_name_key" ON "StorageUnit"("labId", "name");

-- CreateIndex
CREATE INDEX "StorageAssignment_specimenId_idx" ON "StorageAssignment"("specimenId");

-- CreateIndex
CREATE INDEX "StorageAssignment_orgId_unitId_releasedAt_idx" ON "StorageAssignment"("orgId", "unitId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionRule_orgId_specimenType_key" ON "RetentionRule"("orgId", "specimenType");

-- CreateIndex
CREATE UNIQUE INDEX "RecollectionRequest_rejectedSpecimenId_key" ON "RecollectionRequest"("rejectedSpecimenId");

-- CreateIndex
CREATE INDEX "RecollectionRequest_orgId_status_idx" ON "RecollectionRequest"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Courier_orgId_name_key" ON "Courier"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TransportManifest_trackingRef_key" ON "TransportManifest"("trackingRef");

-- CreateIndex
CREATE INDEX "TransportManifest_orgId_status_idx" ON "TransportManifest"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransportManifest_orgId_number_key" ON "TransportManifest"("orgId", "number");

-- CreateIndex
CREATE INDEX "ManifestItem_orgId_specimenId_idx" ON "ManifestItem"("orgId", "specimenId");

-- CreateIndex
CREATE UNIQUE INDEX "ManifestItem_manifestId_specimenId_key" ON "ManifestItem"("manifestId", "specimenId");

-- CreateIndex
CREATE INDEX "CourierEvent_manifestId_at_idx" ON "CourierEvent"("manifestId", "at");

-- AddForeignKey
ALTER TABLE "StorageAssignment" ADD CONSTRAINT "StorageAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "StorageUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestItem" ADD CONSTRAINT "ManifestItem_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "TransportManifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierEvent" ADD CONSTRAINT "CourierEvent_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "TransportManifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- one specimen per slot at a time
CREATE UNIQUE INDEX "StorageAssignment_active_slot_key" ON "StorageAssignment" ("unitId", "slot") WHERE "releasedAt" IS NULL;
CREATE UNIQUE INDEX "StorageAssignment_active_specimen_key" ON "StorageAssignment" ("specimenId") WHERE "releasedAt" IS NULL;
