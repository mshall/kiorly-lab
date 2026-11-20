/** Duplicate-patient detection (pure). Two registry rows are candidates when a strong key matches or name + DOB match after normalisation. */
export interface DupCandidate {
  id: string;
  fullName: string;
  dateOfBirth: Date | null;
  phone: string | null;
  nationalIdHash: string | null;
}

const AR_DIACRITICS = /[ً-ْـ]/g;
/** Normalises Arabic/Latin names: lower-case, no diacritics/tatweel, unified alef/yaa/taa-marbuta, single spaces. */
export function normName(s: string): string {
  return s.toLowerCase().replace(AR_DIACRITICS, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}
export const normPhone = (p: string | null): string | null => { const d = (p ?? "").replace(/\D/g, ""); return d.length >= 8 ? d.slice(-9) : null; };
const dob = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Reasons two records look like the same person (empty = not duplicates). */
export function dupReasons(a: DupCandidate, b: DupCandidate): string[] {
  const out: string[] = [];
  if (a.nationalIdHash && a.nationalIdHash === b.nationalIdHash) out.push("NATIONAL_ID");
  const pa = normPhone(a.phone);
  if (pa && pa === normPhone(b.phone) && dob(a.dateOfBirth) && dob(a.dateOfBirth) === dob(b.dateOfBirth)) out.push("PHONE_DOB");
  if (dob(a.dateOfBirth) && dob(a.dateOfBirth) === dob(b.dateOfBirth) && normName(a.fullName) === normName(b.fullName)) out.push("NAME_DOB");
  return out;
}

/** Groups candidates into duplicate clusters (union-find over pairwise reasons). */
export function clusterDuplicates<T extends DupCandidate>(rows: T[]): { members: T[]; reasons: string[] }[] {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const reasons = new Map<number, Set<string>>();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const r = dupReasons(rows[i]!, rows[j]!);
      if (!r.length) continue;
      parent[find(j)] = find(i);
      const root = find(i);
      reasons.set(root, new Set([...(reasons.get(root) ?? []), ...r]));
    }
  }
  const groups = new Map<number, T[]>();
  rows.forEach((r, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), r]));
  return [...groups.entries()].filter(([, m]) => m.length > 1).map(([root, members]) => ({ members, reasons: [...(reasons.get(root) ?? [])] }));
}
