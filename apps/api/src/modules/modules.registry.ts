/** Bounded contexts from KX-07. Source of truth for placeholder modules (tested). */
export const BOUNDED_CONTEXTS = [
  { dir: "orders", name: "OrdersModule", prefix: "KLORD", title: "Test catalogue, orders and collection", safetyPath: false },
  { dir: "specimens", name: "SpecimensModule", prefix: "KLSPC", title: "Accession, specimens and chain of custody", safetyPath: true },
  { dir: "analysis-qc", name: "AnalysisQcModule", prefix: "KLQC", title: "Analysis, QC and validation", safetyPath: true },
  { dir: "release", name: "ReleaseModule", prefix: "KLCRIT", title: "Release and critical values", safetyPath: true },
  { dir: "business", name: "BusinessModule", prefix: "KLBIZ", title: "Business: price lists, invoices, TAT", safetyPath: false },
] as const;
