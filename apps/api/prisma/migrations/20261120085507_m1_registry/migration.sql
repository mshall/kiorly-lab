-- CreateEnum
CREATE TYPE "ReferrerKind" AS ENUM ('DOCTOR', 'CLINIC', 'HOSPITAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('NONE', 'PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('RESULT_SHARING', 'DATA_PROCESSING', 'MARKETING', 'RESEARCH');

-- CreateEnum
CREATE TYPE "ReferrerAccount" AS ENUM ('COMMISSION', 'CREDIT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StaffRole" ADD VALUE 'SUPERVISOR';
ALTER TYPE "StaffRole" ADD VALUE 'FINANCE';

-- AlterTable
ALTER TABLE "LabOrder" ADD COLUMN     "referrerId" TEXT;

-- AlterTable
ALTER TABLE "PatientRef" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "email" TEXT,
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "mrn" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "PatientConsent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v0',
    "channel" TEXT NOT NULL DEFAULT 'DESK',
    "capturedBy" TEXT NOT NULL,
    "note" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referrer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "ReferrerKind" NOT NULL DEFAULT 'DOCTOR',
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "licenceNo" TEXT,
    "deliveryChannels" "NotificationChannel"[] DEFAULT ARRAY[]::"NotificationChannel"[],
    "deliverOnRelease" BOOLEAN NOT NULL DEFAULT false,
    "preferredLocale" TEXT NOT NULL DEFAULT 'ar',
    "commissionType" "CommissionType" NOT NULL DEFAULT 'NONE',
    "commissionValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(14,2),
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "portalTokenHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referrer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferrerLedgerEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "account" "ReferrerAccount" NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "memo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferrerLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientConsent_orgId_patientId_kind_capturedAt_idx" ON "PatientConsent"("orgId", "patientId", "kind", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Referrer_portalTokenHash_key" ON "Referrer"("portalTokenHash");

-- CreateIndex
CREATE INDEX "Referrer_orgId_name_idx" ON "Referrer"("orgId", "name");

-- CreateIndex
CREATE INDEX "ReferrerLedgerEntry_orgId_referrerId_createdAt_idx" ON "ReferrerLedgerEntry"("orgId", "referrerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferrerLedgerEntry_referrerId_type_invoiceId_key" ON "ReferrerLedgerEntry"("referrerId", "type", "invoiceId");

-- CreateIndex
CREATE INDEX "PatientRef_orgId_nationalIdHash_idx" ON "PatientRef"("orgId", "nationalIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "PatientRef_orgId_mrn_key" ON "PatientRef"("orgId", "mrn");

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferrerLedgerEntry" ADD CONSTRAINT "ReferrerLedgerEntry_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

