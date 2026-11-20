/**
 * ICD-10 hint list for the order-entry "clinical info" field. A SMALL synthetic subset for typeahead and test suggestions only: not a coding system,
 * not clinical guidance (suggestions are placeholders pending pathologist review, NH-LB-009).
 */
export interface IcdHint { code: string; en: string; ar: string; suggest: string[] }
export const ICD_HINTS: IcdHint[] = [
  { code: "E11", en: "Type 2 diabetes mellitus", ar: "السكري من النوع الثاني", suggest: ["GLU", "HBA1C", "KFT"] },
  { code: "E10", en: "Type 1 diabetes mellitus", ar: "السكري من النوع الأول", suggest: ["GLU", "HBA1C"] },
  { code: "E03", en: "Hypothyroidism", ar: "قصور الغدة الدرقية", suggest: ["TSH", "FT4"] },
  { code: "E05", en: "Thyrotoxicosis (hyperthyroidism)", ar: "فرط نشاط الغدة الدرقية", suggest: ["TSH", "FT4"] },
  { code: "D50", en: "Iron deficiency anaemia", ar: "أنيميا نقص الحديد", suggest: ["CBC", "FERR", "IRON"] },
  { code: "D64", en: "Anaemia, unspecified", ar: "أنيميا غير محددة", suggest: ["CBC"] },
  { code: "N18", en: "Chronic kidney disease", ar: "الفشل الكلوي المزمن", suggest: ["KFT", "CBC"] },
  { code: "K76", en: "Other liver disease", ar: "أمراض الكبد", suggest: ["LFT"] },
  { code: "B18", en: "Chronic viral hepatitis", ar: "التهاب الكبد الفيروسي المزمن", suggest: ["LFT", "HBSAG", "HCV"] },
  { code: "I10", en: "Essential hypertension", ar: "ارتفاع ضغط الدم", suggest: ["KFT", "LIPID", "GLU"] },
  { code: "E78", en: "Disorders of lipoprotein metabolism", ar: "اضطراب الدهون", suggest: ["LIPID"] },
  { code: "N39", en: "Urinary tract infection", ar: "التهاب المسالك البولية", suggest: ["UA", "UCULT"] },
  { code: "R50", en: "Fever of unknown origin", ar: "حمى مجهولة السبب", suggest: ["CBC", "CRP", "BCULT"] },
  { code: "J18", en: "Pneumonia", ar: "التهاب رئوي", suggest: ["CBC", "CRP", "SCULT"] },
  { code: "O09", en: "Supervision of high-risk pregnancy", ar: "متابعة حمل عالي الخطورة", suggest: ["CBC", "GLU", "TSH"] },
  { code: "Z00", en: "General medical examination (check-up)", ar: "فحص طبي عام", suggest: ["CHECKUP1"] },
  { code: "E55", en: "Vitamin D deficiency", ar: "نقص فيتامين د", suggest: ["VITD"] },
  { code: "M10", en: "Gout", ar: "النقرس", suggest: ["URIC", "KFT"] },
  { code: "D69", en: "Purpura and other haemorrhagic conditions", ar: "اضطرابات النزف", suggest: ["CBC", "PTINR"] },
  { code: "C80", en: "Malignant neoplasm, unspecified", ar: "ورم خبيث", suggest: ["HISTO"] },
  { code: "R10", en: "Abdominal and pelvic pain", ar: "ألم في البطن", suggest: ["CBC", "LFT", "AMYL"] },
  { code: "A09", en: "Infectious gastroenteritis", ar: "التهاب معدي معوي", suggest: ["STOOL", "CBC"] },
];

/** Case-insensitive search by code prefix or English/Arabic text. */
export function searchIcd(q: string, limit = 10): IcdHint[] {
  const n = q.trim().toLowerCase();
  if (!n) return ICD_HINTS.slice(0, limit);
  return ICD_HINTS.filter((h) => h.code.toLowerCase().startsWith(n) || h.en.toLowerCase().includes(n) || h.ar.includes(q.trim())).slice(0, limit);
}
export const isIcdCode = (c: string) => /^[A-Z]\d{2}(\.\d{1,4})?$/.test(c);
