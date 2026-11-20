/** Bounded contexts from KX-07. Source of truth for module registration and the safety-path list (tested). */
export const BOUNDED_CONTEXTS = [
  { dir: "catalogue", name: "CatalogueModule", prefix: "KLORD01/KLQC03", title: "Test and analyte catalogue, reference intervals, price versions", safetyPath: false },
  { dir: "orders", name: "OrdersModule", prefix: "KLORD", title: "Test catalogue, orders and collection", safetyPath: false },
  { dir: "specimens", name: "SpecimensModule", prefix: "KLSPC", title: "Accession, specimens and chain of custody", safetyPath: true },
  { dir: "analysis-qc", name: "AnalysisQcModule", prefix: "KLQC", title: "Analysis, QC and validation", safetyPath: true },
  { dir: "release", name: "ReleaseModule", prefix: "KLCRIT", title: "Release and critical values", safetyPath: true },
  { dir: "critical", name: "CriticalModule", prefix: "KLCRIT01", title: "Critical-value alerts, acknowledgement and escalation", safetyPath: true },
  { dir: "field-safety", name: "FieldSafetyModule", prefix: "KLORD04/HVSAF", title: "Phlebotomist field lifecycle, safety timer, SOS and unsafe-abort (@kiorly/field-visit)", safetyPath: true },
  { dir: "analyzers", name: "AnalyzersModule", prefix: "KLQC01", title: "Analyzer bridge (ASTM E1394 / HL7 v2) and simulator", safetyPath: false },
  { dir: "admin", name: "AdminModule", prefix: "LB-F07", title: "Auth session, onboarding, staff/RBAC, settings", safetyPath: false },
  { dir: "business", name: "BusinessModule", prefix: "KLBIZ", title: "Business: price lists, invoices, TAT", safetyPath: false },
  { dir: "registry", name: "RegistryModule", prefix: "KLPAT", title: "Standalone patient registry, referrers directory, commission/credit accounts, doctor portal", safetyPath: false },
  { dir: "reception", name: "ReceptionModule", prefix: "KLORD06", title: "Reception: appointments, queue/token board, audited order edit, ICD hints", safetyPath: false },
  { dir: "preanalytics", name: "PreanalyticsModule", prefix: "KLSPC05", title: "Storage racks/freezers, retention & disposal, recollections, transport manifests and courier tracking", safetyPath: true },
  { dir: "microbiology", name: "MicrobiologyModule", prefix: "KLQC06", title: "Microbiology: culture & sensitivity with organisms, antibiotic panels, selective reporting", safetyPath: false },
  { dir: "histopathology", name: "HistopathologyModule", prefix: "KLQC07", title: "Histopathology and cytology basic reporting with pathologist sign-out and addenda", safetyPath: false },
] as const;
