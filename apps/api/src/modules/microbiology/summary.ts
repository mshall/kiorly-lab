/** Builds the patient-report text of a microbiology case (pure). Only `reported` susceptibilities appear (selective reporting). */
export interface SummaryIsolate { organism: string; quantity?: string | null; susceptibilities: { antibiotic: string; interpretation: "S" | "I" | "R" | "SDD" | "NS"; reported: boolean }[] }
export interface Summary { site?: string | null; growth: boolean; hours?: number | null; comment?: string | null; isolates: SummaryIsolate[] }

const LABEL = { S: "Sensitive", I: "Intermediate", R: "Resistant", SDD: "Susceptible, dose-dependent", NS: "Non-susceptible" } as const;

export function summarizeCase(c: Summary): string {
  const lines: string[] = [];
  if (!c.growth) lines.push(`No growth${c.hours ? ` after ${c.hours} h incubation` : ""}.`);
  else {
    for (const iso of c.isolates) {
      lines.push(`Isolate: ${iso.organism}${iso.quantity ? ` (${iso.quantity})` : ""}`);
      const rep = iso.susceptibilities.filter((s) => s.reported);
      for (const k of ["S", "SDD", "I", "R", "NS"] as const) {
        const names = rep.filter((s) => s.interpretation === k).map((s) => s.antibiotic);
        if (names.length) lines.push(`  ${LABEL[k]}: ${names.join(", ")}`);
      }
    }
  }
  if (c.comment) lines.push(c.comment);
  return lines.join("\n");
}

/** Every bacterial isolate needs at least one reported susceptibility before sign-off; yeasts may be reported without a panel. */
export function missingSusceptibility(isolates: { organism: string; gram: string; reportedCount: number }[]): string[] {
  return isolates.filter((i) => i.gram !== "YEAST" && i.reportedCount === 0).map((i) => i.organism);
}
