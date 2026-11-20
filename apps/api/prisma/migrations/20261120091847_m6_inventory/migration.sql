-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM ('REAGENT', 'CONSUMABLE', 'CALIBRATOR', 'CONTROL', 'GENERAL');

-- CreateEnum
CREATE TYPE "InventoryLotStatus" AS ENUM ('ACTIVE', 'QUARANTINE', 'EXPIRED', 'DEPLETED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'CONSUMPTION', 'ADJUSTMENT', 'COUNT_VARIANCE', 'DISPOSAL');

-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'COMPLETED');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "category" "InventoryCategory" NOT NULL DEFAULT 'REAGENT',
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "reorderLevel" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reorderQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "storageTemp" TEXT,
    "avgUnitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "lastUnitCost" DECIMAL(14,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiryDate" DATE,
    "qtyReceived" DECIMAL(14,3) NOT NULL,
    "qtyOnHand" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "location" TEXT,
    "status" "InventoryLotStatus" NOT NULL DEFAULT 'ACTIVE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "type" "MovementType" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4),
    "refType" TEXT,
    "refId" TEXT,
    "shortfall" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "memo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyPerTest" DECIMAL(14,4) NOT NULL,
    "wastagePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ConsumptionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyOrdered" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "qtyReceived" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "poId" TEXT,
    "supplierId" TEXT NOT NULL,
    "invoiceRef" TEXT,
    "note" TEXT,
    "receivedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiryDate" DATE,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3),
    "variance" DECIMAL(14,3),

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_orgId_name_key" ON "Supplier"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_orgId_code_key" ON "InventoryItem"("orgId", "code");

-- CreateIndex
CREATE INDEX "InventoryLot_orgId_itemId_status_idx" ON "InventoryLot"("orgId", "itemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_itemId_labId_lotNumber_key" ON "InventoryLot"("itemId", "labId", "lotNumber");

-- CreateIndex
CREATE INDEX "StockMovement_orgId_itemId_createdAt_idx" ON "StockMovement"("orgId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_refType_refId_idx" ON "StockMovement"("refType", "refId");

-- CreateIndex
CREATE INDEX "ConsumptionRule_orgId_testId_idx" ON "ConsumptionRule"("orgId", "testId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionRule_testId_itemId_key" ON "ConsumptionRule"("testId", "itemId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_orgId_status_idx" ON "PurchaseOrder"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orgId_number_key" ON "PurchaseOrder"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_orgId_number_key" ON "GoodsReceipt"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_orgId_number_key" ON "StockCount"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_lotId_key" ON "StockCountLine"("countId", "lotId");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionRule" ADD CONSTRAINT "ConsumptionRule_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

