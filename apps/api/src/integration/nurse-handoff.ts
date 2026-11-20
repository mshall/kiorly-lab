import type { LabOrderPlacedData } from "@kiorex/contracts";

/**
 * KNLAB01 / KLORD05 mapping from the published `LabOrderPlaced` event (kiorex-contracts 1.6.0, emitted by Kiorly Clinic's NURSE edition,
 * ADR-031, and relayed by Kiorex) to the Kiorly Lab inbound order (`POST /integration/v1/orders`, client source KIORLY_NURSE).
 *
 * Since 1.6.0 the event itself carries everything the order needs (ratified optional fields `patient`, `identifiersChecked`, `nurseCollection`,
 * `prescriberName`), so the relay maps it without side data. Reference implementation of what Kiorex does (`nurse-lab-relay.service.ts` there).
 */
export class NurseHandoffError extends Error {
  constructor(public readonly code: "ITEM_CODE_REQUIRED" | "CONSENT_TOKEN_REQUIRED" | "NURSE_COLLECTION_REQUIRED" | "PATIENT_REQUIRED", message: string) {
    super(message);
  }
}

export interface NurseHandoffOptions {
  priority?: "ROUTINE" | "URGENT" | "STAT";
  /** Add the Kiorex vault channel when the patient has a linked Kiorex vault and has not revoked LAB_RESULTS sharing. */
  vault?: boolean;
}

/** Pure mapping; throws NurseHandoffError when the event cannot be placed with a lab. */
export function labOrderPlacedToInbound(data: LabOrderPlacedData, opts: NurseHandoffOptions = {}) {
  if (!data.consentToken) throw new NurseHandoffError("CONSENT_TOKEN_REQUIRED", "LabOrderPlaced without a consent token cannot be handed to a lab");
  const missing = data.items.filter((i) => !i.code).map((i) => i.nameEn);
  if (missing.length) throw new NurseHandoffError("ITEM_CODE_REQUIRED", `lab catalogue code missing for: ${missing.join(", ")}`);
  if (!data.nurseCollection) throw new NurseHandoffError("NURSE_COLLECTION_REQUIRED", "a Nurse hand-off needs the collection facts (nurseCollection)");
  if (!data.patient) throw new NurseHandoffError("PATIENT_REQUIRED", "a Nurse hand-off needs the minimum patient demographics (patient)");
  const c = data.nurseCollection;
  return {
    sourceRef: data.orderId,
    ...(data.preferredLabId ? { labId: data.preferredLabId } : {}),
    patient: { ...data.patient, externalId: data.patientRef },
    testCodes: data.items.map((i) => i.code as string),
    priority: opts.priority ?? "ROUTINE",
    ...(data.orderingClinicianId || data.prescriberName ? { referringDoctor: { ...(data.prescriberName ? { name: data.prescriberName } : {}), ...(data.orderingClinicianId ? { ref: data.orderingClinicianId } : {}) } } : {}),
    consentChannels: opts.vault ? (["KIORLY_NURSE_IMPORT", "KIOREX_VAULT"] as const) : (["KIORLY_NURSE_IMPORT"] as const),
    identifiersChecked: data.identifiersChecked ?? [],
    nurseCollection: {
      visitRef: c.visitRef, collectorRef: c.collectorRef, ...(c.collectorName ? { collectorName: c.collectorName } : {}), collectedAt: c.collectedAt,
      ...(c.handedOverAt ? { handedOverAt: c.handedOverAt } : {}), ...(c.temperatureC != null ? { temperatureC: c.temperatureC } : {}), consentToken: data.consentToken, samples: c.samples,
    },
  };
}
