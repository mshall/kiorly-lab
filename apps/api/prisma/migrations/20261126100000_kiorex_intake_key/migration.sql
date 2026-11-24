-- Kiorex Connect: the intake key Kiorex issued (AES-GCM sealed) gets its own settings column instead of living in the append-only audit snapshot.
ALTER TABLE "Tenant" ADD COLUMN "kiorexIntakeKeyEnc" TEXT;

-- Backfill from the latest connect snapshot that carried the key. (AuditLog is append-only by trigger: old snapshots keep their sealed copy, new snapshots never carry it.)
UPDATE "Tenant" t SET "kiorexIntakeKeyEnc" = s.k
FROM (
  SELECT DISTINCT ON ("orgId") "orgId", meta->>'intakeKeyEnc' AS k
  FROM "AuditLog"
  WHERE "entityType" = 'KiorexConnect' AND action = 'kiorex_connect.state' AND meta ? 'intakeKeyEnc' AND coalesce(meta->>'intakeKeyEnc', '') <> ''
  ORDER BY "orgId", "at" DESC
) s
WHERE s."orgId" = t.id AND t."kiorexIntakeKeyEnc" IS NULL;
