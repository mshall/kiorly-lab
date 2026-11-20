-- CreateEnum
CREATE TYPE "ReportLanguage" AS ENUM ('AR', 'EN', 'BILINGUAL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT,
    "name" TEXT NOT NULL,
    "language" "ReportLanguage" NOT NULL DEFAULT 'BILINGUAL',
    "headerTitle" TEXT,
    "headerSubtitle" TEXT,
    "footerText" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#3730A3',
    "showQr" BOOLEAN NOT NULL DEFAULT true,
    "showRanges" BOOLEAN NOT NULL DEFAULT true,
    "logo" BYTEA,
    "logoType" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDelivery" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reportVersionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipientMasked" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "notificationId" TEXT,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportTemplate_orgId_labId_idx" ON "ReportTemplate"("orgId", "labId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportTemplate_orgId_name_key" ON "ReportTemplate"("orgId", "name");

-- CreateIndex
CREATE INDEX "ReportDelivery_orgId_reportVersionId_idx" ON "ReportDelivery"("orgId", "reportVersionId");

