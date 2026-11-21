-- Additive, nullable: read-back note captured at critical-value acknowledgement (web and app share it).
ALTER TABLE "CriticalAlert" ADD COLUMN "readBackNote" TEXT;
