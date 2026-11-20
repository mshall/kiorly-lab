-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'CALLED', 'SERVING', 'DONE', 'SKIPPED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Lab" ADD COLUMN     "appointmentCapacity" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "appointmentSlotMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "closingHour" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "openingHour" INTEGER NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "LabOrder" ADD COLUMN     "appointmentId" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "clinicalInfo" TEXT,
ADD COLUMN     "fastingConfirmed" BOOLEAN,
ADD COLUMN     "icdCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "patientId" TEXT,
    "patientName" TEXT NOT NULL,
    "phone" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'WALK_IN',
    "testCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "packageCode" TEXT,
    "fasting" BOOLEAN NOT NULL DEFAULT false,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "note" TEXT,
    "orderId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInAt" TIMESTAMP(3),

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueTicket" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "seq" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'ROUTINE',
    "patientName" TEXT,
    "counter" TEXT,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "orderId" TEXT,
    "appointmentId" TEXT,
    "calledAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRevision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_orgId_labId_startsAt_idx" ON "Appointment"("orgId", "labId", "startsAt");

-- CreateIndex
CREATE INDEX "QueueTicket_orgId_labId_businessDate_status_idx" ON "QueueTicket"("orgId", "labId", "businessDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QueueTicket_labId_businessDate_code_key" ON "QueueTicket"("labId", "businessDate", "code");

-- CreateIndex
CREATE INDEX "OrderRevision_orgId_orderId_idx" ON "OrderRevision"("orgId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRevision_orderId_revision_key" ON "OrderRevision"("orderId", "revision");

