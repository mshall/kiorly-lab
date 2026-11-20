import type { Db } from "../../common/db";

export type QcBlocker = "QC_RUN_MISSING" | "QC_RUN_FAILED" | "QC_BLOCK_OPEN" | "QC_STALE" | "INSTRUMENT_MISSING";

/**
 * safety.lab.qc_block — the service-level gate (the DB trigger kx_enforce_qc_before_release is the backstop).
 * A result is releasable only when it is covered by a non-failing QC run, no QC block is OPEN for the analyte/instrument,
 * and the covering run is within the configured validity window. Not flag-controlled, not configurable per tenant to "off".
 */
export async function qcBlockers(
  db: Db,
  r: { orgId: string; instrumentId: string | null; analyteId: string; qcRunId: string | null; enteredAt: Date; derivedFromIds?: string[] },
  validityHours: number,
): Promise<QcBlocker[]> {
  const out: QcBlocker[] = [];
  if (!r.instrumentId) out.push("INSTRUMENT_MISSING");
  if (!r.qcRunId) out.push("QC_RUN_MISSING");
  else {
    const run = await db.qcRun.findUnique({ where: { id: r.qcRunId } });
    if (!run) out.push("QC_RUN_MISSING");
    else {
      if (run.status === "FAIL") out.push("QC_RUN_FAILED");
      if (r.enteredAt.getTime() - run.runAt.getTime() > validityHours * 3_600_000) out.push("QC_STALE");
    }
  }
  if (r.instrumentId) {
    // a calculated value is only as good as its inputs: a block on any input analyte blocks it too
    const open = await db.qcBlock.count({ where: { orgId: r.orgId, instrumentId: r.instrumentId, analyteId: { in: [r.analyteId, ...(r.derivedFromIds ?? [])] }, status: "OPEN" } });
    if (open > 0) out.push("QC_BLOCK_OPEN");
  }
  return out;
}
