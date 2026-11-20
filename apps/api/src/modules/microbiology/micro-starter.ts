/**
 * SYNTHETIC starter microbiology catalogue (organisms, antibiotics, panels). Interpretation breakpoints (CLSI/EUCAST) are licensed material and are NOT
 * included: the bench enters S/I/R from the lab's own breakpoint tables (NEEDS_HUMAN NH-LB-013). Panels are examples pending microbiologist review.
 */
export const ORGANISMS: { code: string; nameEn: string; nameAr: string; gram: "POS" | "NEG" | "YEAST" | "OTHER" }[] = [
  { code: "ECOLI", nameEn: "Escherichia coli", nameAr: "الإشريكية القولونية", gram: "NEG" },
  { code: "KPNEU", nameEn: "Klebsiella pneumoniae", nameAr: "الكلبسيلة الرئوية", gram: "NEG" },
  { code: "PAERU", nameEn: "Pseudomonas aeruginosa", nameAr: "الزائفة الزنجارية", gram: "NEG" },
  { code: "PMIRA", nameEn: "Proteus mirabilis", nameAr: "المتقلبة العجيبة", gram: "NEG" },
  { code: "ABAUM", nameEn: "Acinetobacter baumannii", nameAr: "الراكدة البومانية", gram: "NEG" },
  { code: "SAURE", nameEn: "Staphylococcus aureus", nameAr: "المكورة العنقودية الذهبية", gram: "POS" },
  { code: "SEPID", nameEn: "Staphylococcus epidermidis", nameAr: "المكورة العنقودية البشروية", gram: "POS" },
  { code: "EFAEC", nameEn: "Enterococcus faecalis", nameAr: "المكورة المعوية البرازية", gram: "POS" },
  { code: "SPNEU", nameEn: "Streptococcus pneumoniae", nameAr: "المكورة العقدية الرئوية", gram: "POS" },
  { code: "SPYOG", nameEn: "Streptococcus pyogenes", nameAr: "المكورة العقدية القيحية", gram: "POS" },
  { code: "SALMO", nameEn: "Salmonella species", nameAr: "السالمونيلا", gram: "NEG" },
  { code: "CALBI", nameEn: "Candida albicans", nameAr: "المبيضات البيضاء", gram: "YEAST" },
];
export const ANTIBIOTICS: { code: string; nameEn: string; nameAr: string; cls: string }[] = [
  { code: "AMP", nameEn: "Ampicillin", nameAr: "أمبيسيلين", cls: "Penicillins" },
  { code: "AMC", nameEn: "Amoxicillin-clavulanate", nameAr: "أموكسيسيلين/كلافولانيك", cls: "Penicillins" },
  { code: "TZP", nameEn: "Piperacillin-tazobactam", nameAr: "بيبيراسيلين/تازوباكتام", cls: "Penicillins" },
  { code: "CXM", nameEn: "Cefuroxime", nameAr: "سيفوروكسيم", cls: "Cephalosporins" },
  { code: "CRO", nameEn: "Ceftriaxone", nameAr: "سيفترياكسون", cls: "Cephalosporins" },
  { code: "CAZ", nameEn: "Ceftazidime", nameAr: "سيفتازيديم", cls: "Cephalosporins" },
  { code: "FEP", nameEn: "Cefepime", nameAr: "سيفيبيم", cls: "Cephalosporins" },
  { code: "MEM", nameEn: "Meropenem", nameAr: "ميروبينيم", cls: "Carbapenems" },
  { code: "IPM", nameEn: "Imipenem", nameAr: "إيميبينيم", cls: "Carbapenems" },
  { code: "GEN", nameEn: "Gentamicin", nameAr: "جنتاميسين", cls: "Aminoglycosides" },
  { code: "AMK", nameEn: "Amikacin", nameAr: "أميكاسين", cls: "Aminoglycosides" },
  { code: "CIP", nameEn: "Ciprofloxacin", nameAr: "سيبروفلوكساسين", cls: "Fluoroquinolones" },
  { code: "LVX", nameEn: "Levofloxacin", nameAr: "ليفوفلوكساسين", cls: "Fluoroquinolones" },
  { code: "SXT", nameEn: "Trimethoprim-sulfamethoxazole", nameAr: "تراي ميثوبريم/سلفاميثوكسازول", cls: "Folate pathway" },
  { code: "NIT", nameEn: "Nitrofurantoin", nameAr: "نيتروفورانتوين", cls: "Urinary agents" },
  { code: "FOX", nameEn: "Cefoxitin (MRSA screen)", nameAr: "سيفوكسيتين", cls: "Cephalosporins" },
  { code: "VAN", nameEn: "Vancomycin", nameAr: "فانكومايسين", cls: "Glycopeptides" },
  { code: "LZD", nameEn: "Linezolid", nameAr: "لينزوليد", cls: "Oxazolidinones" },
  { code: "CLI", nameEn: "Clindamycin", nameAr: "كليندامايسين", cls: "Lincosamides" },
  { code: "ERY", nameEn: "Erythromycin", nameAr: "إريثروميسين", cls: "Macrolides" },
  { code: "DOX", nameEn: "Doxycycline", nameAr: "دوكسيسيكلين", cls: "Tetracyclines" },
  { code: "COL", nameEn: "Colistin", nameAr: "كوليستين", cls: "Polymyxins" },
];
export const PANELS: { name: string; organismGroup: string; antibiotics: string[] }[] = [
  { name: "Enterobacterales", organismGroup: "Enterobacterales", antibiotics: ["AMP", "AMC", "TZP", "CXM", "CRO", "CAZ", "FEP", "MEM", "GEN", "AMK", "CIP", "SXT", "NIT"] },
  { name: "Staphylococcus", organismGroup: "Staphylococcus", antibiotics: ["FOX", "GEN", "CIP", "SXT", "CLI", "ERY", "DOX", "VAN", "LZD"] },
  { name: "Pseudomonas / non-fermenters", organismGroup: "Non-fermenters", antibiotics: ["TZP", "CAZ", "FEP", "MEM", "IPM", "GEN", "AMK", "CIP", "LVX", "COL"] },
  { name: "Enterococcus", organismGroup: "Enterococcus", antibiotics: ["AMP", "VAN", "LZD", "CIP", "GEN"] },
];
