import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { rollbackTx } from "./tx";

/** Frozen-v1 schema expectations (KX-07). Changes need a new named migration. */
export const schemaSmoke = {
  models: [
    "Analyte", "TestDefinition", "ReferenceInterval", "CriticalRule", "LabOrder", "OrderItem", "HomeCollection", "Specimen",
    "CustodyEvent", "Instrument", "QcMaterialLevel", "QcRun", "QcBlock", "Result", "ReportVersion", "ReleaseRecord",
    "CriticalAlert", "OutboxEvent", "AuditLog", "Invoice", "Payment", "LedgerEntry", "PriceList", "PriceListItem", "B2bAccount", "AnalyzerMessage", "ReportShareLink", "NotificationAttempt", "IntegrationClient", "CollectionSlot", "AutoVerificationRule", "CashClose", "SendOutCost", "SlaAlert", "IdempotencyRecord", "SequenceCounter",
  ],
  /** Child/reference tables that inherit tenancy through a parent FK. */
  unscoped: ["Tenant", "TestAnalyte", "TestPackageItem", "OrderItem", "FlagSnapshotCache", "InvoiceLine", "ProviderWebhookEvent", "PassportRevocation", "LogoutTokenSeen", "HandoffCode", "RateLimitBucket", "PlanPrice", "DemoMarker", "PasswordResetToken"],
  async invariants(prisma: PrismaClient) {
    const seed = async (tx: Prisma.TransactionClient) => {
      const tenant = await tx.tenant.create({ data: { name: "t" } });
      const orgId = tenant.id;
      const lab = await tx.lab.create({ data: { orgId, name: "l" } });
      const patient = await tx.patientRef.create({ data: { orgId, fullName: "p" } });
      const order = await tx.labOrder.create({ data: { orgId, labId: lab.id, patientId: patient.id, source: "WALK_IN", createdBy: "u" } });
      const test = await tx.testDefinition.create({ data: { orgId, code: "CBC", nameEn: "CBC", specimenType: "blood" } });
      const item = await tx.orderItem.create({ data: { orderId: order.id, testId: test.id, price: 10 } });
      const specimen = await tx.specimen.create({ data: { orgId, labId: lab.id, orderId: order.id, accessionNumber: "A-1", barcode: "B-1", specimenType: "blood" } });
      const analyte = await tx.analyte.create({ data: { orgId, code: "HB", nameEn: "Hb" } });
      const instrument = await tx.instrument.create({ data: { orgId, labId: lab.id, name: "XN", kind: "ANALYZER" } });
      const material = await tx.qcMaterialLevel.create({ data: { orgId, analyteId: analyte.id, level: "LEVEL_1", materialLot: "M1", targetMean: 13, targetSd: 0.3 } });
      const run = (status: "PASS" | "FAIL") =>
        tx.qcRun.create({ data: { orgId, instrumentId: instrument.id, materialId: material.id, value: 13, zScore: status === "PASS" ? 0 : 3.5, status, violatedRules: status === "FAIL" ? ["1_3s"] : [], runBy: "u" } });
      const report = await tx.reportVersion.create({ data: { orgId, orderId: order.id, version: 1, signedBy: "dr", signedAt: new Date(), contentHash: "h", storageKey: "k" } });
      return { orgId, lab, order, item, specimen, analyte, instrument, run, reportVersionId: report.id };
    };
    const result = (s: Awaited<ReturnType<typeof seed>>, extra: Record<string, unknown>) => ({
      data: { orgId: s.orgId, orderItemId: s.item.id, specimenId: s.specimen.id, analyteId: s.analyte.id, instrumentId: s.instrument.id, source: "MANUAL" as const, enteredBy: "u", ...extra },
    });
    const signed = (s: Awaited<ReturnType<typeof seed>>) => ({ medicalValidatedBy: "dr", medicalValidatedAt: new Date(), techValidatedBy: "tech", releasedAt: new Date(), releasedReportVersionId: s.reportVersionId });

    // duplicate accession rejected (stop-ship: replay test)
    await assert.rejects(
      rollbackTx(prisma, async (tx) => {
        const s = await seed(tx);
        await tx.specimen.create({ data: { orgId: s.orgId, labId: s.lab.id, orderId: s.order.id, accessionNumber: "A-1", barcode: "B-2", specimenType: "blood" } });
      }),
      /Unique constraint/,
    );
    // chain of custody is append-only
    await assert.rejects(
      rollbackTx(prisma, async (tx) => {
        const s = await seed(tx);
        const e = await tx.custodyEvent.create({ data: { orgId: s.orgId, specimenId: s.specimen.id, type: "COLLECTED", actorId: "u" } });
        await tx.custodyEvent.update({ where: { id: e.id }, data: { note: "edited" } });
      }),
      /append-only/,
    );
    // release without a QC run reference is rejected
    await assert.rejects(rollbackTx(prisma, async (tx) => { const s = await seed(tx); await tx.result.create(result(s, signed(s))); }), /QC run is missing or failed/);
    // release without medical validation is rejected
    await assert.rejects(
      rollbackTx(prisma, async (tx) => { const s = await seed(tx); const r = await s.run("PASS"); await tx.result.create(result(s, { qcRunId: r.id, releasedAt: new Date() })); }),
      /result_release_requires_qc_and_signature/,
    );
    // release against a FAILED QC run is rejected (stop-ship: QC violation injection)
    await assert.rejects(
      rollbackTx(prisma, async (tx) => { const s = await seed(tx); const r = await s.run("FAIL"); await tx.result.create(result(s, { qcRunId: r.id, ...signed(s) })); }),
      /QC run is missing or failed/,
    );
    // release with an open QC block is rejected even if a later run passed
    await assert.rejects(
      rollbackTx(prisma, async (tx) => {
        const s = await seed(tx);
        const bad = await s.run("FAIL");
        const good = await s.run("PASS");
        await tx.qcBlock.create({ data: { orgId: s.orgId, instrumentId: s.instrument.id, analyteId: s.analyte.id, openedByRunId: bad.id, rule: "1_3s" } });
        await tx.result.create(result(s, { qcRunId: good.id, ...signed(s) }));
      }),
      /open QC block/,
    );
    // passing QC + medical validation => release allowed
    await rollbackTx(prisma, async (tx) => { const s = await seed(tx); const r = await s.run("PASS"); await tx.result.create(result(s, { qcRunId: r.id, ...signed(s) })); });

    // corrected report (v2) needs a reason
    await assert.rejects(
      rollbackTx(prisma, async (tx) => {
        const s = await seed(tx);
        await tx.reportVersion.create({ data: { orgId: s.orgId, orderId: s.order.id, version: 2, signedBy: "dr", signedAt: new Date(), contentHash: "h", storageKey: "k" } });
      }),
      /report_version_signed/,
    );
    // release without a signed report version is rejected (authorized release)
    await assert.rejects(
      rollbackTx(prisma, async (tx) => { const s = await seed(tx); const r = await s.run("PASS"); await tx.result.create(result(s, { qcRunId: r.id, medicalValidatedBy: "dr", medicalValidatedAt: new Date(), techValidatedBy: "tech", releasedAt: new Date() })); }),
      /result_release_requires_signed_report/,
    );
    // release without technical validation is rejected
    await assert.rejects(
      rollbackTx(prisma, async (tx) => { const s = await seed(tx); const r = await s.run("PASS"); await tx.result.create(result(s, { qcRunId: r.id, medicalValidatedBy: "dr", medicalValidatedAt: new Date(), releasedAt: new Date(), releasedReportVersionId: s.reportVersionId })); }),
      /result_release_requires_signed_report/,
    );
    // a released value can never be edited in place
    await assert.rejects(
      rollbackTx(prisma, async (tx) => {
        const s = await seed(tx);
        const r = await s.run("PASS");
        const res = await tx.result.create(result(s, { qcRunId: r.id, valueNumeric: 13, ...signed(s) }));
        await tx.result.update({ where: { id: res.id }, data: { valueNumeric: 14 } });
      }),
      /immutable/,
    );
    // signed report versions, QC runs, audit log and ledger are append-only
    await assert.rejects(rollbackTx(prisma, async (tx) => { const s = await seed(tx); await tx.reportVersion.update({ where: { id: s.reportVersionId }, data: { contentHash: "x" } }); }), /append-only/);
    await assert.rejects(rollbackTx(prisma, async (tx) => { const s = await seed(tx); const r = await s.run("PASS"); await tx.qcRun.update({ where: { id: r.id }, data: { status: "FAIL" } }); }), /append-only/);
    await assert.rejects(rollbackTx(prisma, async (tx) => { const s = await seed(tx); const a = await tx.auditLog.create({ data: { orgId: s.orgId, action: "x", entityType: "t", entityId: "1" } }); await tx.auditLog.delete({ where: { id: a.id } }); }), /append-only/);
    await assert.rejects(rollbackTx(prisma, async (tx) => { const s = await seed(tx); const l = await tx.ledgerEntry.create({ data: { orgId: s.orgId, refType: "t", refId: "1", debit: "CASH_DRAWER", credit: "RECEIVABLES", amount: 5, currency: "EGP" } }); await tx.ledgerEntry.update({ where: { id: l.id }, data: { amount: 6 } }); }), /append-only/);
    // critical rule ack window is bounded
    await assert.rejects(rollbackTx(prisma, async (tx) => { const s = await seed(tx); await tx.criticalRule.create({ data: { orgId: s.orgId, analyteId: s.analyte.id, criticalHigh: 9, ackWithinMinutes: 0 } }); }), /critical_rule_ack_window/);
    // duplicate payment idempotency key is rejected
    await assert.rejects(
      rollbackTx(prisma, async (tx) => {
        const s = await seed(tx);
        const inv = await tx.invoice.create({ data: { orgId: s.orgId, labId: s.lab.id, number: "I-1", subtotal: 10, vatRatePercent: 0, vatTotal: 0, total: 10, createdBy: "u" } });
        const p = { orgId: s.orgId, labId: s.lab.id, invoiceId: inv.id, method: "CASH" as const, amount: 5, idempotencyKey: "k", receivedBy: "u" };
        await tx.payment.create({ data: p });
        await tx.payment.create({ data: p });
      }),
      /Unique constraint/,
    );
  },
};
