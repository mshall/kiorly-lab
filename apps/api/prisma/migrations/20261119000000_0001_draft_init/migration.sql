-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Edition" AS ENUM ('LITE', 'PRO', 'CHAIN');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'LAB_DIRECTOR', 'AUTHORIZED_SIGNATORY', 'TECHNOLOGIST', 'PHLEBOTOMIST', 'RECEPTION', 'BRANCH_MANAGER');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('M', 'F', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('WALK_IN', 'KIORLY_CLINIC', 'KIOREX_BOOKING', 'REFERRING_DOCTOR');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_COLLECTION', 'COLLECTED', 'IN_LAB', 'PARTIALLY_RESULTED', 'AWAITING_VALIDATION', 'VALIDATED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'RESULTED', 'VALIDATED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CollectionType" AS ENUM ('IN_LAB', 'HOME');

-- CreateEnum
CREATE TYPE "HomeCollectionStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'COLLECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SpecimenStatus" AS ENUM ('PENDING_COLLECTION', 'COLLECTED', 'IN_TRANSIT', 'RECEIVED', 'PROCESSING', 'STORED', 'DISPOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CustodyEventType" AS ENUM ('COLLECTED', 'TRANSPORT_STARTED', 'RECEIVED', 'PROCESSING_STARTED', 'ALIQUOTED', 'STORED', 'DISPOSED', 'REJECTED', 'LABEL_MISMATCH_BLOCKED');

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('HAEMOLYSED', 'INSUFFICIENT_VOLUME', 'MISLABELLED', 'WRONG_CONTAINER', 'CLOTTED', 'OTHER');

-- CreateEnum
CREATE TYPE "InstrumentKind" AS ENUM ('ANALYZER', 'MANUAL_BENCH');

-- CreateEnum
CREATE TYPE "QcLevel" AS ENUM ('LEVEL_1', 'LEVEL_2', 'LEVEL_3');

-- CreateEnum
CREATE TYPE "QcRunStatus" AS ENUM ('PASS', 'WARNING', 'FAIL');

-- CreateEnum
CREATE TYPE "QcBlockStatus" AS ENUM ('OPEN', 'CLEARED');

-- CreateEnum
CREATE TYPE "ResultSource" AS ENUM ('ANALYZER_ASTM', 'ANALYZER_HL7', 'MANUAL');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('ENTERED', 'TECH_VALIDATED', 'MEDICAL_VALIDATED', 'RELEASED', 'CORRECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ResultFlag" AS ENUM ('NORMAL', 'LOW', 'HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH', 'ABNORMAL');

-- CreateEnum
CREATE TYPE "ReleaseChannel" AS ENUM ('PRINTED', 'PATIENT_LINK_OTP', 'KIORLY_CLINIC_IMPORT', 'KIOREX_VAULT');

-- CreateEnum
CREATE TYPE "CriticalAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "externalOrgId" TEXT,
    "name" TEXT NOT NULL,
    "edition" "Edition" NOT NULL DEFAULT 'LITE',
    "marketCode" TEXT NOT NULL DEFAULT 'EG',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lab" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenceNo" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subject" TEXT,
    "displayName" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "signatoryLicenceNo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analyte" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "unit" TEXT,
    "precision" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Analyte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestDefinition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "specimenType" TEXT NOT NULL,
    "container" TEXT,
    "volumeMl" DECIMAL(6,2),
    "fastingRequired" BOOLEAN NOT NULL DEFAULT false,
    "prepInstructionsEn" TEXT,
    "prepInstructionsAr" TEXT,
    "tatMinutes" INTEGER,
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sendOut" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TestDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAnalyte" (
    "testId" TEXT NOT NULL,
    "analyteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestAnalyte_pkey" PRIMARY KEY ("testId","analyteId")
);

-- CreateTable
CREATE TABLE "TestPackage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "price" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "TestPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestPackageItem" (
    "packageId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,

    CONSTRAINT "TestPackageItem_pkey" PRIMARY KEY ("packageId","testId")
);

-- CreateTable
CREATE TABLE "ReferenceInterval" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "analyteId" TEXT NOT NULL,
    "sex" "Sex",
    "ageMinDays" INTEGER NOT NULL DEFAULT 0,
    "ageMaxDays" INTEGER,
    "low" DECIMAL(12,4),
    "high" DECIMAL(12,4),
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "ReferenceInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriticalRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "analyteId" TEXT NOT NULL,
    "criticalLow" DECIMAL(12,4),
    "criticalHigh" DECIMAL(12,4),
    "ackWithinMinutes" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CriticalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientRef" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "externalId" TEXT,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "sex" "Sex" NOT NULL DEFAULT 'UNKNOWN',
    "phone" TEXT,
    "nationalIdHash" TEXT,
    "nationalIdLast4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceRef" TEXT,
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "identifiersChecked" TEXT[],
    "referringDoctorName" TEXT,
    "referringDoctorRef" TEXT,
    "consentShareChannels" "ReleaseChannel"[],
    "consentCapturedAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'ROUTINE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "price" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeCollection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "HomeCollectionStatus" NOT NULL DEFAULT 'REQUESTED',
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "address" TEXT NOT NULL,
    "geo" JSONB,
    "phlebotomistId" TEXT,
    "routeSequence" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "labelPhotoKey" TEXT,

    CONSTRAINT "HomeCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specimen" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "accessionNumber" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "specimenType" TEXT NOT NULL,
    "container" TEXT,
    "parentSpecimenId" TEXT,
    "status" "SpecimenStatus" NOT NULL DEFAULT 'PENDING_COLLECTION',
    "rejectionReason" "RejectionReason",
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Specimen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodyEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "specimenId" TEXT NOT NULL,
    "type" "CustodyEventType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "location" TEXT,
    "temperatureC" DECIMAL(5,2),
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "InstrumentKind" NOT NULL,
    "interfaceRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcMaterialLevel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "analyteId" TEXT NOT NULL,
    "level" "QcLevel" NOT NULL,
    "materialLot" TEXT NOT NULL,
    "targetMean" DECIMAL(14,5) NOT NULL,
    "targetSd" DECIMAL(14,5) NOT NULL,
    "expiresAt" DATE,

    CONSTRAINT "QcMaterialLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "value" DECIMAL(14,5) NOT NULL,
    "zScore" DECIMAL(8,4) NOT NULL,
    "status" "QcRunStatus" NOT NULL,
    "violatedRules" TEXT[],
    "runBy" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QcRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcBlock" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "analyteId" TEXT NOT NULL,
    "status" "QcBlockStatus" NOT NULL DEFAULT 'OPEN',
    "openedByRunId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "clearedByRunId" TEXT,
    "clearedBy" TEXT,
    "clearNote" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "QcBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Result" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "specimenId" TEXT NOT NULL,
    "analyteId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "qcRunId" TEXT,
    "source" "ResultSource" NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'ENTERED',
    "valueNumeric" DECIMAL(14,5),
    "valueText" TEXT,
    "unit" TEXT,
    "flag" "ResultFlag" NOT NULL DEFAULT 'NORMAL',
    "referenceIntervalId" TEXT,
    "deltaCheckFailed" BOOLEAN NOT NULL DEFAULT false,
    "enteredBy" TEXT NOT NULL,
    "secondEntryBy" TEXT,
    "techValidatedBy" TEXT,
    "techValidatedAt" TIMESTAMP(3),
    "medicalValidatedBy" TEXT,
    "medicalValidatedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "correctionReason" TEXT,
    "supersedesId" TEXT,
    "signedBy" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reportVersionId" TEXT NOT NULL,
    "channel" "ReleaseChannel" NOT NULL,
    "consentRef" TEXT NOT NULL,
    "secureLinkId" TEXT,
    "releasedBy" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriticalAlert" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "status" "CriticalAlertStatus" NOT NULL DEFAULT 'OPEN',
    "notifiedUserRef" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackDeadlineAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "escalatedToUserId" TEXT,
    "escalatedAt" TIMESTAMP(3),

    CONSTRAINT "CriticalAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "meta" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlagSnapshotCache" (
    "product" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "etag" TEXT,
    "body" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlagSnapshotCache_pkey" PRIMARY KEY ("product")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_externalOrgId_key" ON "Tenant"("externalOrgId");

-- CreateIndex
CREATE INDEX "Lab_orgId_idx" ON "Lab"("orgId");

-- CreateIndex
CREATE INDEX "StaffUser_orgId_role_idx" ON "StaffUser"("orgId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_orgId_subject_key" ON "StaffUser"("orgId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "Analyte_orgId_code_key" ON "Analyte"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TestDefinition_orgId_code_key" ON "TestDefinition"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TestPackage_orgId_code_key" ON "TestPackage"("orgId", "code");

-- CreateIndex
CREATE INDEX "ReferenceInterval_orgId_analyteId_idx" ON "ReferenceInterval"("orgId", "analyteId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceInterval_analyteId_sex_ageMinDays_version_key" ON "ReferenceInterval"("analyteId", "sex", "ageMinDays", "version");

-- CreateIndex
CREATE INDEX "CriticalRule_orgId_analyteId_idx" ON "CriticalRule"("orgId", "analyteId");

-- CreateIndex
CREATE INDEX "PatientRef_orgId_phone_idx" ON "PatientRef"("orgId", "phone");

-- CreateIndex
CREATE INDEX "PatientRef_orgId_externalId_idx" ON "PatientRef"("orgId", "externalId");

-- CreateIndex
CREATE INDEX "LabOrder_orgId_labId_status_idx" ON "LabOrder"("orgId", "labId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrder_orgId_source_sourceRef_key" ON "LabOrder"("orgId", "source", "sourceRef");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeCollection_orderId_key" ON "HomeCollection"("orderId");

-- CreateIndex
CREATE INDEX "HomeCollection_orgId_slotStart_idx" ON "HomeCollection"("orgId", "slotStart");

-- CreateIndex
CREATE INDEX "HomeCollection_phlebotomistId_slotStart_idx" ON "HomeCollection"("phlebotomistId", "slotStart");

-- CreateIndex
CREATE INDEX "Specimen_orgId_orderId_idx" ON "Specimen"("orgId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Specimen_labId_accessionNumber_key" ON "Specimen"("labId", "accessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Specimen_labId_barcode_key" ON "Specimen"("labId", "barcode");

-- CreateIndex
CREATE INDEX "CustodyEvent_specimenId_occurredAt_idx" ON "CustodyEvent"("specimenId", "occurredAt");

-- CreateIndex
CREATE INDEX "CustodyEvent_orgId_occurredAt_idx" ON "CustodyEvent"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "Instrument_orgId_labId_idx" ON "Instrument"("orgId", "labId");

-- CreateIndex
CREATE UNIQUE INDEX "QcMaterialLevel_analyteId_level_materialLot_key" ON "QcMaterialLevel"("analyteId", "level", "materialLot");

-- CreateIndex
CREATE INDEX "QcRun_instrumentId_materialId_runAt_idx" ON "QcRun"("instrumentId", "materialId", "runAt");

-- CreateIndex
CREATE INDEX "QcBlock_orgId_instrumentId_analyteId_status_idx" ON "QcBlock"("orgId", "instrumentId", "analyteId", "status");

-- CreateIndex
CREATE INDEX "Result_orgId_orderItemId_idx" ON "Result"("orgId", "orderItemId");

-- CreateIndex
CREATE INDEX "Result_specimenId_idx" ON "Result"("specimenId");

-- CreateIndex
CREATE INDEX "Result_analyteId_instrumentId_enteredAt_idx" ON "Result"("analyteId", "instrumentId", "enteredAt");

-- CreateIndex
CREATE INDEX "ReportVersion_orgId_orderId_idx" ON "ReportVersion"("orgId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportVersion_orderId_version_key" ON "ReportVersion"("orderId", "version");

-- CreateIndex
CREATE INDEX "ReleaseRecord_orgId_reportVersionId_idx" ON "ReleaseRecord"("orgId", "reportVersionId");

-- CreateIndex
CREATE INDEX "CriticalAlert_orgId_status_ackDeadlineAt_idx" ON "CriticalAlert"("orgId", "status", "ackDeadlineAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_occurredAt_idx" ON "OutboxEvent"("status", "occurredAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_orgId_idx" ON "OutboxEvent"("orgId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_at_idx" ON "AuditLog"("orgId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Lab" ADD CONSTRAINT "Lab_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAnalyte" ADD CONSTRAINT "TestAnalyte_testId_fkey" FOREIGN KEY ("testId") REFERENCES "TestDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAnalyte" ADD CONSTRAINT "TestAnalyte_analyteId_fkey" FOREIGN KEY ("analyteId") REFERENCES "Analyte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPackageItem" ADD CONSTRAINT "TestPackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TestPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPackageItem" ADD CONSTRAINT "TestPackageItem_testId_fkey" FOREIGN KEY ("testId") REFERENCES "TestDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceInterval" ADD CONSTRAINT "ReferenceInterval_analyteId_fkey" FOREIGN KEY ("analyteId") REFERENCES "Analyte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriticalRule" ADD CONSTRAINT "CriticalRule_analyteId_fkey" FOREIGN KEY ("analyteId") REFERENCES "Analyte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_testId_fkey" FOREIGN KEY ("testId") REFERENCES "TestDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeCollection" ADD CONSTRAINT "HomeCollection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_parentSpecimenId_fkey" FOREIGN KEY ("parentSpecimenId") REFERENCES "Specimen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyEvent" ADD CONSTRAINT "CustodyEvent_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "Specimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcMaterialLevel" ADD CONSTRAINT "QcMaterialLevel_analyteId_fkey" FOREIGN KEY ("analyteId") REFERENCES "Analyte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcRun" ADD CONSTRAINT "QcRun_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcRun" ADD CONSTRAINT "QcRun_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "QcMaterialLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcBlock" ADD CONSTRAINT "QcBlock_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcBlock" ADD CONSTRAINT "QcBlock_openedByRunId_fkey" FOREIGN KEY ("openedByRunId") REFERENCES "QcRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcBlock" ADD CONSTRAINT "QcBlock_clearedByRunId_fkey" FOREIGN KEY ("clearedByRunId") REFERENCES "QcRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "Specimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_analyteId_fkey" FOREIGN KEY ("analyteId") REFERENCES "Analyte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_qcRunId_fkey" FOREIGN KEY ("qcRunId") REFERENCES "QcRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportVersion" ADD CONSTRAINT "ReportVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRecord" ADD CONSTRAINT "ReleaseRecord_reportVersionId_fkey" FOREIGN KEY ("reportVersionId") REFERENCES "ReportVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriticalAlert" ADD CONSTRAINT "CriticalAlert_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "Result"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- DRAFT invariants (hand-written; ADR-025 safety controls enforced in the DB as
-- defence in depth. Services must ALSO check — these are the last line.)
-- =============================================================================

-- Chain of custody is append-only.
CREATE OR REPLACE FUNCTION kx_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER custody_event_append_only
  BEFORE UPDATE OR DELETE ON "CustodyEvent"
  FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();

-- A report version is always signed; corrections (version > 1) carry a reason.
ALTER TABLE "ReportVersion" ADD CONSTRAINT report_version_signed
  CHECK (length("signedBy") > 0 AND (version = 1 OR "correctionReason" IS NOT NULL));

-- A released result needs a QC run reference and medical validation.
ALTER TABLE "Result" ADD CONSTRAINT result_release_requires_qc_and_signature
  CHECK (
    "releasedAt" IS NULL
    OR ("qcRunId" IS NOT NULL AND "medicalValidatedBy" IS NOT NULL AND "medicalValidatedAt" IS NOT NULL)
  );

ALTER TABLE "CriticalAlert" ADD CONSTRAINT critical_alert_deadline_after_notice
  CHECK ("ackDeadlineAt" > "notifiedAt");

-- QC block: no patient release while the covering QC run FAILED or an OPEN QcBlock exists for the analyte/instrument.
CREATE OR REPLACE FUNCTION kx_enforce_qc_before_release() RETURNS trigger AS $$
DECLARE
  run_status "QcRunStatus";
BEGIN
  IF NEW."releasedAt" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT status INTO run_status FROM "QcRun" WHERE id = NEW."qcRunId";
  IF run_status IS NULL OR run_status = 'FAIL' THEN
    RAISE EXCEPTION 'result % cannot be released: covering QC run is missing or failed', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."instrumentId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "QcBlock" b
    WHERE b."instrumentId" = NEW."instrumentId" AND b."analyteId" = NEW."analyteId" AND b.status = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'result % cannot be released: open QC block for analyte/instrument', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER result_qc_block_on_release
  BEFORE INSERT OR UPDATE ON "Result"
  FOR EACH ROW EXECUTE FUNCTION kx_enforce_qc_before_release();
