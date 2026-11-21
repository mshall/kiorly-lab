-- CreateEnum
CREATE TYPE "PayLinkStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED');

-- AlterEnum
ALTER TYPE "NotificationPurpose" ADD VALUE 'BILLING';

-- CreateTable
CREATE TABLE "PayLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "status" "PayLinkStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "payUrl" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "paymentId" TEXT,
    "failureReason" TEXT,
    "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundRef" TEXT,
    "refundAmount" DECIMAL(14,2),
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderWebhookEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayLink_providerRef_idx" ON "PayLink"("providerRef");

-- CreateIndex
CREATE INDEX "PayLink_refundRef_idx" ON "PayLink"("refundRef");

-- CreateIndex
CREATE INDEX "PayLink_orgId_invoiceId_idx" ON "PayLink"("orgId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PayLink_orgId_idempotencyKey_key" ON "PayLink"("orgId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderWebhookEvent_kind_eventId_key" ON "ProviderWebhookEvent"("kind", "eventId");

