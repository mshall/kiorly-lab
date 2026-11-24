-- GRW-P4-B2: partner side of the Kiorex product acquisition block (additive nullable columns; no existing row changes).
-- `acquisitionLinkId` is set only when the cited code belongs to this organisation; the two *CountedAt columns make the daily counters idempotent per order.
ALTER TABLE "LabOrder"
  ADD COLUMN "acquisitionOrigin" TEXT,
  ADD COLUMN "acquisitionDecisionRef" TEXT,
  ADD COLUMN "acquisitionReason" TEXT,
  ADD COLUMN "acquisitionLinkId" TEXT,
  ADD COLUMN "acquisitionOrderCountedAt" TIMESTAMP(3),
  ADD COLUMN "acquisitionCompletedCountedAt" TIMESTAMP(3);
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_acquisitionOrigin_chk" CHECK ("acquisitionOrigin" IS NULL OR "acquisitionOrigin" IN ('PROVIDER_LED','MARKETPLACE','UNATTRIBUTED'));
CREATE INDEX "LabOrder_acquisitionLinkId_idx" ON "LabOrder"("acquisitionLinkId") WHERE "acquisitionLinkId" IS NOT NULL;
