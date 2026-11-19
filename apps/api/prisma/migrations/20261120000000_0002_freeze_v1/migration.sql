-- CreateEnum
CREATE TYPE "AnalyzerProtocol" AS ENUM ('ASTM_E1394', 'HL7_V2');

-- CreateEnum
CREATE TYPE "AnalyzerMessageStatus" AS ENUM ('PARSED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL', 'PUSH', 'VOICE');

-- CreateEnum
CREATE TYPE "NotificationPurpose" AS ENUM ('CRITICAL_ALERT', 'CRITICAL_ESCALATION', 'RESULT_READY', 'REPORT_CORRECTED', 'COLLECTION_REMINDER', 'RECOLLECTION', 'REPORT_OTP', 'SLA_ALERT');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('CASH_DRAWER', 'CARD_CLEARING', 'RECEIVABLES', 'REVENUE', 'VAT_PAYABLE', 'REFUNDS');

-- AlterTable
ALTER TABLE "Analyte" ADD COLUMN     "analyzerCodes" TEXT[];

-- AlterTable
ALTER TABLE "CriticalAlert" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "HomeCollection" ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "routeDate" DATE,
ADD COLUMN     "slotId" TEXT;

-- AlterTable
ALTER TABLE "Instrument" ADD COLUMN     "apiKeyHash" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "protocol" "AnalyzerProtocol",
ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Lab" ADD COLUMN     "code" TEXT NOT NULL DEFAULT 'LAB';

-- AlterTable
ALTER TABLE "LabOrder" ADD COLUMN     "b2bAccountId" TEXT,
ADD COLUMN     "collectionType" "CollectionType" NOT NULL DEFAULT 'IN_LAB',
ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "referringDoctorPhone" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "packageCode" TEXT,
ADD COLUMN     "specimenId" TEXT;

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "target" TEXT NOT NULL DEFAULT 'KIOREX';

-- AlterTable
ALTER TABLE "PatientRef" ADD COLUMN     "preferredLocale" TEXT NOT NULL DEFAULT 'ar';

-- AlterTable
ALTER TABLE "ReferenceInterval" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "ReportVersion" ADD COLUMN     "sizeBytes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Result" ADD COLUMN     "analyzerMessageId" TEXT,
ADD COLUMN     "autoVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "correctionReason" TEXT,
ADD COLUMN     "deltaPercent" DECIMAL(9,2),
ADD COLUMN     "refHigh" DECIMAL(12,4),
ADD COLUMN     "refLow" DECIMAL(12,4),
ADD COLUMN     "releasedReportVersionId" TEXT,
ADD COLUMN     "supersedesResultId" TEXT;

-- AlterTable
ALTER TABLE "Specimen" ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "labelsPrinted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recollectOfId" TEXT;

-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "email" TEXT,
ADD COLUMN     "labIds" TEXT[];

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EGP',
ADD COLUMN     "qcValidityHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "referringDoctorStatements" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "vatRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SequenceCounter" (
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SequenceCounter_pkey" PRIMARY KEY ("orgId","key")
);

-- CreateTable
CREATE TABLE "CollectionSlot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "booked" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CollectionSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoVerificationRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "analyteId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "maxDeltaPercent" DECIMAL(9,2),
    "requireNormal" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AutoVerificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyzerMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "protocol" "AnalyzerProtocol" NOT NULL,
    "raw" TEXT NOT NULL,
    "status" "AnalyzerMessageStatus" NOT NULL,
    "error" TEXT,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyzerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportShareLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reportVersionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "purpose" "NotificationPurpose" NOT NULL,
    "recipientRef" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "params" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "providerMessageId" TEXT,
    "error" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "testId" TEXT,
    "packageId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "B2bAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceListId" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "creditLimit" DECIMAL(14,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "B2bAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "orderId" TEXT,
    "b2bAccountId" TEXT,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "vatRatePercent" DECIMAL(5,2) NOT NULL,
    "vatTotal" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "paidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "testId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "vatRatePercent" DECIMAL(5,2) NOT NULL,
    "vatAmount" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "pspRef" TEXT,
    "receivedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "debit" "LedgerAccount" NOT NULL,
    "credit" "LedgerAccount" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "memo" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashClose" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "expectedCash" DECIMAL(14,2) NOT NULL,
    "countedCash" DECIMAL(14,2) NOT NULL,
    "variance" DECIMAL(14,2) NOT NULL,
    "closedBy" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "CashClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendOutCost" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "referralLabName" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SendOutCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaAlert" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("orgId","scope","key")
);

-- CreateTable
CREATE TABLE "IntegrationClient" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionSlot_orgId_startsAt_idx" ON "CollectionSlot"("orgId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionSlot_labId_startsAt_key" ON "CollectionSlot"("labId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutoVerificationRule_orgId_analyteId_key" ON "AutoVerificationRule"("orgId", "analyteId");

-- CreateIndex
CREATE INDEX "AnalyzerMessage_orgId_instrumentId_receivedAt_idx" ON "AnalyzerMessage"("orgId", "instrumentId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportShareLink_tokenHash_key" ON "ReportShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ReportShareLink_orgId_reportVersionId_idx" ON "ReportShareLink"("orgId", "reportVersionId");

-- CreateIndex
CREATE INDEX "NotificationAttempt_orgId_createdAt_idx" ON "NotificationAttempt"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationAttempt_relatedType_relatedId_idx" ON "NotificationAttempt"("relatedType", "relatedId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_orgId_name_key" ON "PriceList"("orgId", "name");

-- CreateIndex
CREATE INDEX "PriceListItem_priceListId_testId_effectiveTo_idx" ON "PriceListItem"("priceListId", "testId", "effectiveTo");

-- CreateIndex
CREATE INDEX "PriceListItem_orgId_idx" ON "PriceListItem"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "B2bAccount_orgId_name_key" ON "B2bAccount"("orgId", "name");

-- CreateIndex
CREATE INDEX "Invoice_orgId_status_idx" ON "Invoice"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orgId_number_key" ON "Invoice"("orgId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_orgId_labId_createdAt_idx" ON "Payment"("orgId", "labId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orgId_idempotencyKey_key" ON "Payment"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_orgId_occurredAt_idx" ON "LedgerEntry"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_refType_refId_idx" ON "LedgerEntry"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "CashClose_labId_businessDate_key" ON "CashClose"("labId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "SendOutCost_orderItemId_key" ON "SendOutCost"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaAlert_orderItemId_key" ON "SlaAlert"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationClient_key_key" ON "IntegrationClient"("key");

-- CreateIndex
CREATE INDEX "IntegrationClient_orgId_idx" ON "IntegrationClient"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Lab_orgId_code_key" ON "Lab"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrder_orgId_orderNumber_key" ON "LabOrder"("orgId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_orgId_email_key" ON "StaffUser"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_b2bAccountId_fkey" FOREIGN KEY ("b2bAccountId") REFERENCES "B2bAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_releasedReportVersionId_fkey" FOREIGN KEY ("releasedReportVersionId") REFERENCES "ReportVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionSlot" ADD CONSTRAINT "CollectionSlot_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoVerificationRule" ADD CONSTRAINT "AutoVerificationRule_analyteId_fkey" FOREIGN KEY ("analyteId") REFERENCES "Analyte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyzerMessage" ADD CONSTRAINT "AnalyzerMessage_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportShareLink" ADD CONSTRAINT "ReportShareLink_reportVersionId_fkey" FOREIGN KEY ("reportVersionId") REFERENCES "ReportVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "B2bAccount" ADD CONSTRAINT "B2bAccount_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_b2bAccountId_fkey" FOREIGN KEY ("b2bAccountId") REFERENCES "B2bAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendOutCost" ADD CONSTRAINT "SendOutCost_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaAlert" ADD CONSTRAINT "SlaAlert_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- Freeze-v1 DB safety invariants (hand-written; ADR-025 safety controls)
-- =============================================================================

-- Authorized release: a released result is technically validated and tied to a signed report version.
ALTER TABLE "Result" ADD CONSTRAINT result_release_requires_signed_report
  CHECK ("releasedAt" IS NULL OR ("releasedReportVersionId" IS NOT NULL AND "techValidatedBy" IS NOT NULL));

-- Once released, the analytical value can never change in place (corrections create a new row, KLQC05).
CREATE OR REPLACE FUNCTION kx_result_value_immutable_after_release() RETURNS trigger AS $$
BEGIN
  IF OLD."releasedAt" IS NOT NULL AND (
       NEW."valueNumeric" IS DISTINCT FROM OLD."valueNumeric"
    OR NEW."valueText" IS DISTINCT FROM OLD."valueText"
    OR NEW."analyteId" IS DISTINCT FROM OLD."analyteId"
    OR NEW."specimenId" IS DISTINCT FROM OLD."specimenId"
    OR NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt"
  ) THEN
    RAISE EXCEPTION 'released result % is immutable (create a correction instead)', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER result_immutable_after_release
  BEFORE UPDATE ON "Result"
  FOR EACH ROW EXECUTE FUNCTION kx_result_value_immutable_after_release();

-- Append-only tables: signed report versions, release records, QC runs, audit log, ledger.
CREATE TRIGGER report_version_append_only BEFORE UPDATE OR DELETE ON "ReportVersion" FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();
CREATE TRIGGER release_record_append_only BEFORE UPDATE OR DELETE ON "ReleaseRecord" FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();
CREATE TRIGGER qc_run_append_only BEFORE UPDATE OR DELETE ON "QcRun" FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();
CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();

-- Critical alert ack window is sane (1..1440 minutes) on rules; alerts keep the existing deadline CHECK.
ALTER TABLE "CriticalRule" ADD CONSTRAINT critical_rule_ack_window CHECK ("ackWithinMinutes" BETWEEN 1 AND 1440);

-- Money sanity.
ALTER TABLE "Payment" ADD CONSTRAINT payment_amount_positive CHECK (amount > 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_amount_positive CHECK (amount > 0 AND debit <> credit);
