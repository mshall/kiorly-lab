-- CreateTable
CREATE TABLE "MobileUpgradeRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileUpgradeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MobileUpgradeRequest_orgId_staffId_featureKey_createdAt_idx" ON "MobileUpgradeRequest"("orgId", "staffId", "featureKey", "createdAt");

-- CreateIndex
CREATE INDEX "MobileUpgradeRequest_orgId_status_createdAt_idx" ON "MobileUpgradeRequest"("orgId", "status", "createdAt");
