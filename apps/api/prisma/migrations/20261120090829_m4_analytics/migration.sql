-- CreateEnum
CREATE TYPE "LabSection" AS ENUM ('GENERAL', 'HEMATOLOGY', 'CHEMISTRY', 'IMMUNOLOGY', 'SEROLOGY', 'COAGULATION', 'URINALYSIS', 'MICROBIOLOGY', 'HISTOPATHOLOGY', 'CYTOLOGY', 'MOLECULAR');

-- CreateEnum
CREATE TYPE "AnalyteValueType" AS ENUM ('NUMERIC', 'TEXT', 'SEMI_QUANT', 'CHOICE');

-- CreateEnum
CREATE TYPE "RerunStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MicroStatus" AS ENUM ('RECEIVED', 'INCUBATING', 'PRELIMINARY', 'FINAL');

-- CreateEnum
CREATE TYPE "Susceptibility" AS ENUM ('S', 'I', 'R', 'SDD', 'NS');

-- CreateEnum
CREATE TYPE "HistoKind" AS ENUM ('HISTOPATHOLOGY', 'CYTOLOGY');

-- CreateEnum
CREATE TYPE "HistoStatus" AS ENUM ('RECEIVED', 'GROSSING', 'PROCESSING', 'REPORTING', 'SIGNED_OUT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ResultSource" ADD VALUE 'CALCULATED';
ALTER TYPE "ResultSource" ADD VALUE 'STRUCTURED';

-- DropIndex
DROP INDEX "ReferenceInterval_analyteId_sex_ageMinDays_version_key";

-- AlterTable
ALTER TABLE "Analyte" ADD COLUMN     "allowedValues" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "formula" TEXT,
ADD COLUMN     "normalValues" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "valueType" "AnalyteValueType" NOT NULL DEFAULT 'NUMERIC';

-- AlterTable
ALTER TABLE "AutoVerificationRule" ADD COLUMN     "deltaWindowDays" INTEGER,
ADD COLUMN     "maxDeltaAbsolute" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "Instrument" ADD COLUMN     "sections" "LabSection"[] DEFAULT ARRAY[]::"LabSection"[];

-- AlterTable
ALTER TABLE "ReferenceInterval" ADD COLUMN     "condition" TEXT;

-- AlterTable
ALTER TABLE "Result" ADD COLUMN     "derivedFromIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "dilutionFactor" DECIMAL(10,4),
ADD COLUMN     "rawValue" DECIMAL(14,5),
ADD COLUMN     "rerunOfId" TEXT;

-- AlterTable
ALTER TABLE "TestDefinition" ADD COLUMN     "section" "LabSection" NOT NULL DEFAULT 'GENERAL';

-- CreateTable
CREATE TABLE "RerunRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "analyteId" TEXT NOT NULL,
    "originalResultId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "dilutionFactor" DECIMAL(10,4),
    "status" "RerunStatus" NOT NULL DEFAULT 'OPEN',
    "requestedBy" TEXT NOT NULL,
    "newResultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "RerunRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organism" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "gram" TEXT NOT NULL DEFAULT 'OTHER',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Organism_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Antibiotic" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "antibioticClass" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Antibiotic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AntibioticPanel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organismGroup" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AntibioticPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AntibioticPanelItem" (
    "panelId" TEXT NOT NULL,
    "antibioticId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AntibioticPanelItem_pkey" PRIMARY KEY ("panelId","antibioticId")
);

-- CreateTable
CREATE TABLE "MicrobiologyCase" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "specimenId" TEXT NOT NULL,
    "site" TEXT,
    "gramStain" TEXT,
    "cultureMedia" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "incubationStartedAt" TIMESTAMP(3),
    "status" "MicroStatus" NOT NULL DEFAULT 'RECEIVED',
    "growth" BOOLEAN,
    "comment" TEXT,
    "enteredBy" TEXT NOT NULL,
    "finalizedBy" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MicrobiologyCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MicrobiologyIsolate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "organismId" TEXT NOT NULL,
    "isolateNo" INTEGER NOT NULL DEFAULT 1,
    "quantity" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MicrobiologyIsolate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MicrobiologySusceptibility" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "isolateId" TEXT NOT NULL,
    "antibioticId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'DISK',
    "micMgL" DECIMAL(10,4),
    "zoneMm" INTEGER,
    "interpretation" "Susceptibility" NOT NULL,
    "reported" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MicrobiologySusceptibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoCase" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "specimenId" TEXT NOT NULL,
    "kind" "HistoKind" NOT NULL DEFAULT 'HISTOPATHOLOGY',
    "site" TEXT,
    "clinicalHistory" TEXT,
    "grossDescription" TEXT,
    "microscopicDescription" TEXT,
    "diagnosis" TEXT,
    "morphologyCode" TEXT,
    "synoptic" JSONB,
    "blocks" INTEGER NOT NULL DEFAULT 0,
    "slides" INTEGER NOT NULL DEFAULT 0,
    "status" "HistoStatus" NOT NULL DEFAULT 'RECEIVED',
    "pathologistId" TEXT,
    "signedOutAt" TIMESTAMP(3),
    "resultId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoAddendum" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RerunRequest_orgId_status_idx" ON "RerunRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "RerunRequest_orderItemId_analyteId_status_idx" ON "RerunRequest"("orderItemId", "analyteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Organism_orgId_code_key" ON "Organism"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Antibiotic_orgId_code_key" ON "Antibiotic"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AntibioticPanel_orgId_name_key" ON "AntibioticPanel"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MicrobiologyCase_orderItemId_key" ON "MicrobiologyCase"("orderItemId");

-- CreateIndex
CREATE INDEX "MicrobiologyCase_orgId_status_idx" ON "MicrobiologyCase"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MicrobiologyIsolate_caseId_isolateNo_key" ON "MicrobiologyIsolate"("caseId", "isolateNo");

-- CreateIndex
CREATE UNIQUE INDEX "MicrobiologySusceptibility_isolateId_antibioticId_key" ON "MicrobiologySusceptibility"("isolateId", "antibioticId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoCase_orderItemId_key" ON "HistoCase"("orderItemId");

-- CreateIndex
CREATE INDEX "HistoCase_orgId_status_idx" ON "HistoCase"("orgId", "status");

-- CreateIndex
CREATE INDEX "HistoAddendum_caseId_idx" ON "HistoAddendum"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceInterval_analyteId_sex_ageMinDays_condition_versio_key" ON "ReferenceInterval"("analyteId", "sex", "ageMinDays", "condition", "version");

-- AddForeignKey
ALTER TABLE "AntibioticPanelItem" ADD CONSTRAINT "AntibioticPanelItem_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "AntibioticPanel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AntibioticPanelItem" ADD CONSTRAINT "AntibioticPanelItem_antibioticId_fkey" FOREIGN KEY ("antibioticId") REFERENCES "Antibiotic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicrobiologyIsolate" ADD CONSTRAINT "MicrobiologyIsolate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MicrobiologyCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicrobiologyIsolate" ADD CONSTRAINT "MicrobiologyIsolate_organismId_fkey" FOREIGN KEY ("organismId") REFERENCES "Organism"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicrobiologySusceptibility" ADD CONSTRAINT "MicrobiologySusceptibility_isolateId_fkey" FOREIGN KEY ("isolateId") REFERENCES "MicrobiologyIsolate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicrobiologySusceptibility" ADD CONSTRAINT "MicrobiologySusceptibility_antibioticId_fkey" FOREIGN KEY ("antibioticId") REFERENCES "Antibiotic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoAddendum" ADD CONSTRAINT "HistoAddendum_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "HistoCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

