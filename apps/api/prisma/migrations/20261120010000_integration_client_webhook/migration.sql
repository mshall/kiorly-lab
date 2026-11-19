-- Per-partner Kiorex webhook target + signing secret (kiorex-contracts 1.4.0).
ALTER TABLE "IntegrationClient" ADD COLUMN "kiorexBaseUrl" TEXT, ADD COLUMN "webhookSecretEnc" TEXT;
