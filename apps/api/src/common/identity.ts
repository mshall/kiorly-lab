import { createHash } from "node:crypto";

export const IDENTIFIER_KINDS = ["dateOfBirth", "phone", "nationalId", "externalId"] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

/** Identifier kinds a patient record actually holds. */
export function presentIdentifiers(p: { dateOfBirth?: Date | string | null; phone?: string | null; nationalIdHash?: string | null; externalId?: string | null }): IdentifierKind[] {
  const out: IdentifierKind[] = [];
  if (p.dateOfBirth) out.push("dateOfBirth");
  if (p.phone) out.push("phone");
  if (p.nationalIdHash) out.push("nationalId");
  if (p.externalId) out.push("externalId");
  return out;
}

/** KLORD03: an identity check needs >= 2 DISTINCT identifier kinds, each present on the record. */
export function twoIdentifiersOk(checked: readonly string[], present: readonly IdentifierKind[]): boolean {
  const distinct = [...new Set(checked)].filter((k): k is IdentifierKind => (IDENTIFIER_KINDS as readonly string[]).includes(k));
  return distinct.length >= 2 && distinct.every((k) => present.includes(k));
}

export const hashNationalId = (nid: string): string => createHash("sha256").update(`kx-lab-nid:${nid.replace(/\s+/g, "")}`).digest("hex");

/** Consent per release channel (KLORD03/KLCRIT02). Consent can only widen with an explicit capture; absence means no release on that channel. */
export function channelConsented(consent: readonly string[], channel: string): boolean {
  return consent.includes(channel);
}
