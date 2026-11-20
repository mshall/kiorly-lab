import type { LabOrderPlacedData } from "@kiorex/contracts";

/**
 * KNLAB01 / KLORD05 mapping from the published `LabOrderPlaced` event (kiorex-contracts 1.5.0, emitted by Kiorly Clinic - the Nurse
 * edition included, ADR-031 - and relayed by Kiorex) to the Kiorly Lab inbound order (`POST /integration/v1/orders`, source KIORLY_NURSE).
 *
 * The event itself carries ids + consent token + ordered items only (no demographics, no collection data). The relay supplies what the
 * nurse recorded at the visit as `NurseVisitCollection` (the additive `nurseCollection` block on the inbound order, proposed in NH-LB-034):
 * patient demographics fetched under the consent token, the two identifiers the nurse verified, and the collection / hand-over facts.
 */
export interface NurseVisitCollection {
  visitRef: string;
  collectorRef: string;
  collectorName?: string;
  collectedAt: string;
  handedOverAt?: string;
  temperatureC?: number;
  samples: { label: string; specimenType: string; container?: string }[];
}

export interface NurseHandoffContext {
  patient: { fullName: string; dateOfBirth?: string; sex?: "M" | "F" | "OTHER" | "UNKNOWN"; phone?: string; preferredLocale?: "ar" | "en" };
  identifiersChecked: string[];
  collection: NurseVisitCollection;
  priority?: "ROUTINE" | "URGENT" | "STAT";
}

export class NurseHandoffError extends Error {
  constructor(public readonly code: "ITEM_CODE_REQUIRED" | "CONSENT_TOKEN_REQUIRED", message: string) {
    super(message);
  }
}

/** Pure mapping; throws NurseHandoffError when the event cannot be placed with a lab (an item without a catalogue code, no consent token). */
export function labOrderPlacedToInbound(data: LabOrderPlacedData, ctx: NurseHandoffContext) {
  if (!data.consentToken) throw new NurseHandoffError("CONSENT_TOKEN_REQUIRED", "LabOrderPlaced without a consent token cannot be handed to a lab");
  const missing = data.items.filter((i) => !i.code).map((i) => i.nameEn);
  if (missing.length) throw new NurseHandoffError("ITEM_CODE_REQUIRED", `lab catalogue code missing for: ${missing.join(", ")}`);
  return {
    sourceRef: data.orderId,
    ...(data.preferredLabId ? { labId: data.preferredLabId } : {}),
    patient: { ...ctx.patient, externalId: data.patientRef },
    testCodes: data.items.map((i) => i.code as string),
    priority: ctx.priority ?? "ROUTINE",
    ...(data.orderingClinicianId ? { referringDoctor: { ref: data.orderingClinicianId } } : {}),
    identifiersChecked: ctx.identifiersChecked,
    nurseCollection: { ...ctx.collection, consentToken: data.consentToken },
  };
}
