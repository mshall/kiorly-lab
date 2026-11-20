-- CreateEnum
CREATE TYPE "MobileDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appVersion" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "MobileDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "pushToken" TEXT,
    "pushProvider" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobilePush" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DELIVERED',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),

    CONSTRAINT "MobilePush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileAlertAck" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "ackedBy" TEXT NOT NULL,
    "note" TEXT,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileAlertAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MobileDevice_orgId_status_idx" ON "MobileDevice"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MobileDevice_staffId_deviceId_key" ON "MobileDevice"("staffId", "deviceId");

-- CreateIndex
CREATE INDEX "MobilePush_staffId_createdAt_idx" ON "MobilePush"("staffId", "createdAt");

-- CreateIndex
CREATE INDEX "MobilePush_orgId_staffId_readAt_idx" ON "MobilePush"("orgId", "staffId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "MobileAlertAck_orgId_alertKey_key" ON "MobileAlertAck"("orgId", "alertKey");

