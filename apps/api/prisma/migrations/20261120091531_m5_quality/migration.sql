-- CreateEnum
CREATE TYPE "QcLotStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "CalibrationStatus" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "EqaStatus" AS ENUM ('ACCEPTABLE', 'WARNING', 'UNACCEPTABLE');

-- CreateEnum
CREATE TYPE "MaintKind" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'CLEANING', 'CALIBRATION', 'PARTS');

-- CreateEnum
CREATE TYPE "NcArea" AS ENUM ('PRE_ANALYTICAL', 'ANALYTICAL', 'POST_ANALYTICAL', 'EQUIPMENT', 'DOCUMENT', 'PERSONNEL', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "NcSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NcStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'ACTION', 'VERIFIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CapaKind" AS ENUM ('CORRECTIVE', 'PREVENTIVE');

-- CreateEnum
CREATE TYPE "CapaStatus" AS ENUM ('OPEN', 'DONE', 'VERIFIED');

-- CreateEnum
CREATE TYPE "DocCategory" AS ENUM ('SOP', 'POLICY', 'FORM', 'MANUAL', 'WORK_INSTRUCTION');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "QcMaterialLevel" ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "openedAt" DATE,
ADD COLUMN     "status" "QcLotStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "CalibrationRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "analyteId" TEXT,
    "calibratorLot" TEXT NOT NULL,
    "calibratorExpiry" DATE,
    "status" "CalibrationStatus" NOT NULL,
    "slope" DECIMAL(14,6),
    "intercept" DECIMAL(14,6),
    "performedBy" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextDueAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "CalibrationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EqaEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "sampleCode" TEXT NOT NULL,
    "analyteId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "reportedValue" DECIMAL(14,5) NOT NULL,
    "assignedValue" DECIMAL(14,5) NOT NULL,
    "groupSd" DECIMAL(14,5) NOT NULL,
    "zScore" DECIMAL(8,3) NOT NULL,
    "status" "EqaStatus" NOT NULL,
    "note" TEXT,
    "ncrId" TEXT,
    "enteredBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EqaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "frequencyDays" INTEGER NOT NULL,
    "lastDoneAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "kind" "MaintKind" NOT NULL,
    "performedBy" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "downtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "partsReplaced" TEXT,

    CONSTRAINT "MaintenanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ncr" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "area" "NcArea" NOT NULL DEFAULT 'OTHER',
    "severity" "NcSeverity" NOT NULL DEFAULT 'MINOR',
    "status" "NcStatus" NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "relatedType" TEXT,
    "relatedId" TEXT,
    "rootCause" TEXT,
    "containment" TEXT,
    "raisedBy" TEXT NOT NULL,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ncr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapaAction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ncrId" TEXT NOT NULL,
    "kind" "CapaKind" NOT NULL DEFAULT 'CORRECTIVE',
    "description" TEXT NOT NULL,
    "ownerId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "CapaStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "effectiveness" TEXT,
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapaAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "DocCategory" NOT NULL DEFAULT 'SOP',
    "section" TEXT,
    "ownerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityDocumentVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "authoredBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAck" (
    "versionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAck_pkey" PRIMARY KEY ("versionId","staffId")
);

-- CreateIndex
CREATE INDEX "CalibrationRecord_orgId_instrumentId_performedAt_idx" ON "CalibrationRecord"("orgId", "instrumentId", "performedAt");

-- CreateIndex
CREATE INDEX "EqaEvent_orgId_analyteId_submittedAt_idx" ON "EqaEvent"("orgId", "analyteId", "submittedAt");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_orgId_instrumentId_nextDueAt_idx" ON "MaintenanceSchedule"("orgId", "instrumentId", "nextDueAt");

-- CreateIndex
CREATE INDEX "MaintenanceLog_orgId_instrumentId_performedAt_idx" ON "MaintenanceLog"("orgId", "instrumentId", "performedAt");

-- CreateIndex
CREATE INDEX "Ncr_orgId_status_idx" ON "Ncr"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ncr_orgId_number_key" ON "Ncr"("orgId", "number");

-- CreateIndex
CREATE INDEX "CapaAction_orgId_status_dueAt_idx" ON "CapaAction"("orgId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "QualityDocument_orgId_code_key" ON "QualityDocument"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "QualityDocumentVersion_documentId_version_key" ON "QualityDocumentVersion"("documentId", "version");

-- AddForeignKey
ALTER TABLE "CapaAction" ADD CONSTRAINT "CapaAction_ncrId_fkey" FOREIGN KEY ("ncrId") REFERENCES "Ncr"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityDocumentVersion" ADD CONSTRAINT "QualityDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "QualityDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAck" ADD CONSTRAINT "DocumentAck_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QualityDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

