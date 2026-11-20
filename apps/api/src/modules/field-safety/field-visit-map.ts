import type { HomeCollection, HomeCollectionStatus, StaffRole } from "@prisma/client";
import { type FieldVisit, type HistoryEntry, type VisitState, canViewAddress, maskedAddress } from "@kiorly/field-visit";

/**
 * Maps the Lab's HomeCollection row to the @kiorly/field-visit lifecycle (KLORD04). The package owns the state machine, the
 * address-privacy rule and the safety timer; this file only translates storage. SAFETY PATH (ADR-025): no flags here.
 */
export const STATUS_TO_STATE: Record<HomeCollectionStatus, VisitState> = {
  REQUESTED: "REQUESTED",
  SCHEDULED: "CONFIRMED",
  EN_ROUTE: "ON_MY_WAY",
  ARRIVED: "ARRIVED",
  COLLECTED: "FINISHED",
  FAILED: "NO_SHOW",
  CANCELLED: "CANCELLED",
  ABORTED_UNSAFE: "ABORTED_UNSAFE",
};

export const STATE_TO_STATUS: Record<VisitState, HomeCollectionStatus> = {
  REQUESTED: "REQUESTED",
  CONFIRMED: "SCHEDULED",
  ON_MY_WAY: "EN_ROUTE",
  ARRIVED: "ARRIVED",
  FINISHED: "COLLECTED",
  NO_SHOW: "FAILED",
  CANCELLED: "CANCELLED",
  ABORTED_UNSAFE: "ABORTED_UNSAFE",
};

/** Statuses in which the collector is out in the field: the safety timer, SOS and "I'm OK" apply (never switchable). */
export const FIELD_STATUSES: readonly HomeCollectionStatus[] = ["EN_ROUTE", "ARRIVED"];

type Row = Pick<HomeCollection, "id" | "status" | "slotStart" | "slotEnd" | "phlebotomistId" | "history" | "endedAt">;

export function toFieldVisit(hc: Row): FieldVisit {
  const history = (Array.isArray(hc.history) ? hc.history : []) as unknown as HistoryEntry[];
  return {
    id: hc.id,
    state: STATUS_TO_STATE[hc.status],
    plannedStartMs: hc.slotStart.getTime(),
    plannedEndMs: hc.slotEnd.getTime(),
    assignedClinicianId: hc.phlebotomistId ?? undefined,
    history,
    ...(hc.endedAt ? { endedAtMs: hc.endedAt.getTime() } : {}),
  };
}

/** Organisation admins who may always see a home address inside the privacy window (HVPRV01). Everyone else sees the district only. */
export const ADDRESS_ADMIN_ROLES: readonly StaffRole[] = ["OWNER", "LAB_DIRECTOR", "BRANCH_MANAGER"];

/**
 * HVPRV01 / BR52: only the assigned phlebotomist and org admins see address, phone and coordinates, only once the visit is confirmed,
 * and never 24 h after it ended. Dispatch staff (reception) and other phlebotomists get the district only.
 */
export function presentHomeCollection<T extends Row & Pick<HomeCollection, "address" | "contactPhone" | "geo" | "districtId">>(viewer: { staffId: string; role: StaffRole }, hc: T, nowMs = Date.now()): T & { addressMasked: boolean } {
  const visible = canViewAddress({ userId: viewer.staffId, isOrgAdmin: ADDRESS_ADMIN_ROLES.includes(viewer.role) }, toFieldVisit(hc), nowMs);
  if (visible) return { ...hc, addressMasked: false };
  const m = maskedAddress({ districtId: hc.districtId ?? "" });
  return { ...hc, address: m.districtId ? `[${m.districtId}]` : "[masked]", contactPhone: null, geo: null, addressMasked: true };
}
