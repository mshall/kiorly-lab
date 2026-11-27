-- Lab e-mail + password sign-in (founder decision 28 Nov 2026). Additive: nullable hash, counters, reset tokens. Existing rows keep no password (Passport only).
ALTER TABLE "StaffUser" ADD COLUMN "passwordHash" TEXT, ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "lockedUntil" TIMESTAMP(3), ADD COLUMN "passwordChangedAt" TIMESTAMP(3), ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TYPE "NotificationPurpose" ADD VALUE IF NOT EXISTS 'ACCOUNT_SECURITY';
CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL, "staffId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_staffId_idx" ON "PasswordResetToken"("staffId");
