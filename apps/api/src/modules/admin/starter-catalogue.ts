/**
 * SYNTHETIC starter catalogue for demos, tests and onboarding. NOT clinical guidance: codes, volumes, TATs, intervals and critical limits are
 * placeholders pending pathologist review (NH-LB-009, NH-LB-013, NH-LB-006). Reference interval source is marked SYNTHETIC_DEMO.
 */
export interface StarterAnalyte {
  code: string; nameEn: string; nameAr: string; unit: string; precision: number;
  male?: [number, number]; female?: [number, number]; both?: [number, number];
  critical?: { low?: number; high?: number; ack: number };
  qc?: { mean: number; sd: number };
}
export const STARTER_ANALYTES: StarterAnalyte[] = [
  { code: "HB", nameEn: "Haemoglobin", nameAr: "الهيموجلوبين", unit: "g/dL", precision: 1, male: [13, 17], female: [12, 15.5], critical: { low: 7, high: 20, ack: 30 }, qc: { mean: 14, sd: 0.3 } },
  { code: "WBC", nameEn: "White blood cells", nameAr: "كرات الدم البيضاء", unit: "x10^9/L", precision: 1, both: [4, 11], critical: { low: 1.5, high: 50, ack: 30 }, qc: { mean: 8, sd: 0.4 } },
  { code: "PLT", nameEn: "Platelets", nameAr: "الصفائح الدموية", unit: "x10^9/L", precision: 0, both: [150, 400], critical: { low: 20, high: 1000, ack: 30 }, qc: { mean: 250, sd: 10 } },
  { code: "GLU", nameEn: "Glucose (fasting)", nameAr: "سكر صائم", unit: "mg/dL", precision: 0, both: [70, 100], critical: { low: 40, high: 500, ack: 30 }, qc: { mean: 100, sd: 3 } },
  { code: "CREA", nameEn: "Creatinine", nameAr: "الكرياتينين", unit: "mg/dL", precision: 2, male: [0.7, 1.3], female: [0.5, 1.1], critical: { high: 10, ack: 30 }, qc: { mean: 1, sd: 0.04 } },
  { code: "ALT", nameEn: "ALT", nameAr: "إنزيم الكبد ALT", unit: "U/L", precision: 0, male: [7, 55], female: [7, 45], qc: { mean: 40, sd: 2 } },
  { code: "AST", nameEn: "AST", nameAr: "إنزيم الكبد AST", unit: "U/L", precision: 0, both: [8, 48], qc: { mean: 35, sd: 2 } },
  { code: "K", nameEn: "Potassium", nameAr: "البوتاسيوم", unit: "mmol/L", precision: 1, both: [3.5, 5.1], critical: { low: 2.5, high: 6.5, ack: 30 }, qc: { mean: 4.2, sd: 0.1 } },
  { code: "NA", nameEn: "Sodium", nameAr: "الصوديوم", unit: "mmol/L", precision: 0, both: [135, 145], critical: { low: 120, high: 160, ack: 30 }, qc: { mean: 140, sd: 1.2 } },
  { code: "TSH", nameEn: "TSH", nameAr: "هرمون الغدة الدرقية", unit: "mIU/L", precision: 2, both: [0.4, 4], qc: { mean: 2, sd: 0.1 } },
];

export interface StarterTest {
  code: string; nameEn: string; nameAr: string; specimenType: string; container: string; volumeMl: number; fasting?: boolean; tatMinutes: number; price: number; analytes: string[];
  sendOut?: boolean; prepEn?: string; prepAr?: string;
}
export const STARTER_TESTS: StarterTest[] = [
  { code: "CBC", nameEn: "Complete blood count", nameAr: "صورة دم كاملة", specimenType: "Whole blood", container: "EDTA (lavender)", volumeMl: 3, tatMinutes: 120, price: 120, analytes: ["HB", "WBC", "PLT"] },
  { code: "GLU", nameEn: "Fasting glucose", nameAr: "سكر صائم", specimenType: "Serum", container: "Serum gel (yellow)", volumeMl: 3, fasting: true, tatMinutes: 120, price: 40, analytes: ["GLU"], prepEn: "Fast 8-12 hours.", prepAr: "صيام من 8 إلى 12 ساعة." },
  { code: "KFT", nameEn: "Kidney function", nameAr: "وظائف الكلى", specimenType: "Serum", container: "Serum gel (yellow)", volumeMl: 3, tatMinutes: 180, price: 150, analytes: ["CREA", "K", "NA"] },
  { code: "LFT", nameEn: "Liver enzymes", nameAr: "وظائف الكبد", specimenType: "Serum", container: "Serum gel (yellow)", volumeMl: 3, tatMinutes: 180, price: 140, analytes: ["ALT", "AST"] },
  { code: "TSH", nameEn: "TSH", nameAr: "هرمون الغدة الدرقية", specimenType: "Serum", container: "Serum gel (yellow)", volumeMl: 3, tatMinutes: 240, price: 130, analytes: ["TSH"] },
];
export const STARTER_PACKAGES = [{ code: "CHECKUP1", nameEn: "Basic check-up", nameAr: "فحص شامل أساسي", price: 360, tests: ["CBC", "GLU", "KFT", "LFT"] }];
