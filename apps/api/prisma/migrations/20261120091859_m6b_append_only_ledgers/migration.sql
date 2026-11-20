-- This is an empty migration.

-- append-only ledgers (same trigger as AuditLog / LedgerEntry)
CREATE TRIGGER stock_movement_append_only BEFORE UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();
CREATE TRIGGER referrer_ledger_append_only BEFORE UPDATE OR DELETE ON "ReferrerLedgerEntry" FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();
CREATE TRIGGER patient_consent_append_only BEFORE UPDATE OR DELETE ON "PatientConsent" FOR EACH ROW EXECUTE FUNCTION kx_forbid_mutation();
