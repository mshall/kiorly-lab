import type { CustodyEventType, SpecimenStatus } from "../../generated/prisma/client";

export type SpecimenAction = "collect" | "transport" | "receive" | "process" | "store" | "dispose" | "reject" | "retrieve";

const T: Record<SpecimenStatus, Partial<Record<SpecimenAction, SpecimenStatus>>> = {
  PENDING_COLLECTION: { collect: "COLLECTED", reject: "REJECTED" },
  COLLECTED: { transport: "IN_TRANSIT", receive: "RECEIVED", reject: "REJECTED" },
  IN_TRANSIT: { receive: "RECEIVED", reject: "REJECTED" },
  RECEIVED: { process: "PROCESSING", store: "STORED", reject: "REJECTED" },
  PROCESSING: { store: "STORED", dispose: "DISPOSED", reject: "REJECTED" },
  STORED: { retrieve: "PROCESSING", dispose: "DISPOSED" },
  DISPOSED: {},
  REJECTED: {},
};

export const ACTION_EVENT: Record<SpecimenAction, CustodyEventType> = {
  collect: "COLLECTED",
  transport: "TRANSPORT_STARTED",
  receive: "RECEIVED",
  process: "PROCESSING_STARTED",
  store: "STORED",
  dispose: "DISPOSED",
  reject: "REJECTED",
  retrieve: "PROCESSING_STARTED",
};

/** KLSPC03 chain: collected -> transported -> received -> processed -> stored/disposed. Returns null when the move is illegal. */
export function nextSpecimenStatus(current: SpecimenStatus, action: SpecimenAction): SpecimenStatus | null {
  return T[current][action] ?? null;
}

/** Actions that need the label to be scanned and matched (safety.lab.label_match). */
export const SCAN_REQUIRED: readonly SpecimenAction[] = ["collect", "receive", "process"];

/** Statuses in which analytical results may be entered. */
export const ANALYZABLE: readonly SpecimenStatus[] = ["PROCESSING"];
