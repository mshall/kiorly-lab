import type { OrderSource } from "@prisma/client";

/** External sources emit LabOrderCreated / LabOrderStatusChanged to Kiorex (walk-in and referring-doctor orders do not). */
export const EXTERNAL_SOURCES: readonly OrderSource[] = ["KIOREX_BOOKING", "KIORLY_CLINIC", "KIORLY_NURSE"];
export const isExternalSource = (s: OrderSource): boolean => EXTERNAL_SOURCES.includes(s);

/**
 * kiorex-contracts 1.5.0 `source` enum on Lab* events is KIOREX_BOOKING | KIORLY_CLINIC. Kiorly Nurse is an EDITION of Kiorly
 * Clinic (ADR-031), so nurse-collected orders go out as KIORLY_CLINIC with the additive `originEdition: "NURSE"`.
 */
export function eventSource(s: OrderSource): { source: "KIOREX_BOOKING" | "KIORLY_CLINIC"; originEdition?: "NURSE" } {
  if (s === "KIORLY_NURSE") return { source: "KIORLY_CLINIC", originEdition: "NURSE" };
  return { source: s === "KIOREX_BOOKING" ? "KIOREX_BOOKING" : "KIORLY_CLINIC" };
}
