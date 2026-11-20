-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'SALARIES', 'UTILITIES', 'REAGENTS', 'CONSUMABLES', 'EQUIPMENT', 'MAINTENANCE', 'TRANSPORT', 'MARKETING', 'PROFESSIONAL_FEES', 'OTHER');

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'BANK';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'TRANSFER';
ALTER TYPE "PaymentMethod" ADD VALUE 'CHEQUE';

-- AlterTable
ALTER TABLE "B2bAccount" ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "contractEnd" DATE,
ADD COLUMN     "contractRef" TEXT,
ADD COLUMN     "contractStart" DATE,
ADD COLUMN     "coveragePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CORPORATE';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "grossSubtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "payerAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "payer" TEXT NOT NULL DEFAULT 'PATIENT',
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "amount" DECIMAL(14,2) NOT NULL,
    "vendor" TEXT,
    "paidVia" TEXT NOT NULL DEFAULT 'CASH',
    "fromDrawer" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Refund_orgId_createdAt_idx" ON "Refund"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Expense_orgId_date_idx" ON "Expense"("orgId", "date");


-- backfill: existing invoices had no discounts, so the gross equals the (net) subtotal
UPDATE "Invoice" SET "grossSubtotal" = "subtotal" WHERE "grossSubtotal" = 0;
UPDATE "Invoice" SET "dueAt" = "issuedAt" WHERE "dueAt" IS NULL AND "issuedAt" IS NOT NULL;
-- refunds are append-only
CREATE TRIGGER refund_append_only BEFORE UPDATE OR DELETE ON "Refund" FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();
