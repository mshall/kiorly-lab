/**
 * SYNTHETIC extended catalogue for demos (NOT clinical guidance; reference intervals and prices are placeholders pending pathologist review,
 * NH-LB-009 / NH-LB-013 / NH-LB-006). One analyte + one test per row, then multi-analyte panels and check-up packages.
 * Row format: code;English;Arabic;SECTION;unit;low;high;price;specimen
 */
export const SPECIMENS: Record<string, { type: string; container: string; volumeMl: number; fasting?: boolean }> = {
  SER: { type: "Serum", container: "Serum gel (yellow)", volumeMl: 3 },
  SERF: { type: "Serum", container: "Serum gel (yellow)", volumeMl: 3, fasting: true },
  EDTA: { type: "Whole blood", container: "EDTA (lavender)", volumeMl: 3 },
  CIT: { type: "Plasma", container: "Citrate (blue)", volumeMl: 2.7 },
  FLU: { type: "Plasma", container: "Fluoride (grey)", volumeMl: 2 },
  HEP: { type: "Plasma", container: "Heparin (green)", volumeMl: 3 },
  URN: { type: "Urine", container: "Urine cup", volumeMl: 20 },
  STL: { type: "Stool", container: "Stool container", volumeMl: 5 },
  SWB: { type: "Swab", container: "Transport swab", volumeMl: 1 },
  FLD: { type: "Body fluid", container: "Sterile tube", volumeMl: 3 },
  TIS: { type: "Tissue", container: "Formalin pot", volumeMl: 0 },
  BC: { type: "Blood", container: "Blood culture bottle", volumeMl: 10 },
};

const RAW = `
HGB;Haemoglobin (single);الهيموجلوبين;HEMATOLOGY;g/dL;12;17;40;EDTA
RBC;Red blood cells;كرات الدم الحمراء;HEMATOLOGY;x10^12/L;4.2;5.9;35;EDTA
HCT;Haematocrit;الهيماتوكريت;HEMATOLOGY;%;37;52;30;EDTA
MCV;Mean cell volume;متوسط حجم الكرية;HEMATOLOGY;fL;80;100;30;EDTA
MCH;Mean cell haemoglobin;متوسط هيموجلوبين الكرية;HEMATOLOGY;pg;27;33;30;EDTA
MCHC;Mean cell Hb concentration;تركيز هيموجلوبين الكرية;HEMATOLOGY;g/dL;32;36;30;EDTA
RDW;Red cell distribution width;عرض توزيع الكريات;HEMATOLOGY;%;11.5;14.5;30;EDTA
NEUT;Neutrophils %;العدلات;HEMATOLOGY;%;40;75;30;EDTA
LYMP;Lymphocytes %;الخلايا الليمفاوية;HEMATOLOGY;%;20;45;30;EDTA
MONO;Monocytes %;الخلايا الوحيدة;HEMATOLOGY;%;2;10;30;EDTA
EOS;Eosinophils %;الحمضات;HEMATOLOGY;%;1;6;30;EDTA
BASO;Basophils %;القعدات;HEMATOLOGY;%;0;1;30;EDTA
RETIC;Reticulocyte count;الشبكيات;HEMATOLOGY;%;0.5;2.5;60;EDTA
ESR;Erythrocyte sedimentation rate;سرعة الترسيب;HEMATOLOGY;mm/h;0;20;40;EDTA
HBA1C;Glycated haemoglobin (HbA1c);السكر التراكمي;CHEMISTRY;%;4;5.7;120;EDTA
PT;Prothrombin time;زمن البروثرومبين;COAGULATION;sec;11;14;70;CIT
INR;INR;INR;COAGULATION;ratio;0.8;1.2;70;CIT
APTT;aPTT;زمن الثرومبوبلاستين الجزئي;COAGULATION;sec;25;38;80;CIT
FIBR;Fibrinogen;الفيبرينوجين;COAGULATION;mg/dL;200;400;110;CIT
DDIM;D-dimer;دي دايمر;COAGULATION;ug/mL;0;0.5;260;CIT
GLUR;Glucose (random);سكر عشوائي;CHEMISTRY;mg/dL;70;140;35;FLU
GLU2;Glucose 2h post-prandial;سكر بعد الأكل بساعتين;CHEMISTRY;mg/dL;70;140;40;FLU
UREA;Urea;اليوريا;CHEMISTRY;mg/dL;15;45;45;SER
BUN;Blood urea nitrogen;نيتروجين اليوريا;CHEMISTRY;mg/dL;7;20;45;SER
URIC;Uric acid;حمض اليوريك;CHEMISTRY;mg/dL;3.5;7.2;45;SER
CA;Calcium;الكالسيوم;CHEMISTRY;mg/dL;8.5;10.5;45;SER
PHOS;Phosphorus;الفوسفور;CHEMISTRY;mg/dL;2.5;4.5;45;SER
MG;Magnesium;الماغنسيوم;CHEMISTRY;mg/dL;1.7;2.4;55;SER
CL;Chloride;الكلوريد;CHEMISTRY;mmol/L;98;107;40;SER
BICARB;Bicarbonate;البيكربونات;CHEMISTRY;mmol/L;22;29;40;SER
IRON;Iron;الحديد;CHEMISTRY;ug/dL;60;170;60;SER
TIBC;Total iron binding capacity;السعة الرابطة للحديد;CHEMISTRY;ug/dL;250;450;70;SER
FERR;Ferritin;الفيريتين;IMMUNOLOGY;ng/mL;20;250;150;SER
TRSF;Transferrin;الترانسفيرين;CHEMISTRY;mg/dL;200;360;110;SER
B12;Vitamin B12;فيتامين ب12;IMMUNOLOGY;pg/mL;200;900;200;SER
FOL;Folate;الفولات;IMMUNOLOGY;ng/mL;3;17;180;SER
VITD;Vitamin D (25-OH);فيتامين د;IMMUNOLOGY;ng/mL;30;100;320;SER
TBIL;Bilirubin total;البيليروبين الكلي;CHEMISTRY;mg/dL;0.2;1.2;40;SER
DBIL;Bilirubin direct;البيليروبين المباشر;CHEMISTRY;mg/dL;0;0.3;40;SER
ALP;Alkaline phosphatase;الفوسفاتاز القلوي;CHEMISTRY;U/L;40;130;45;SER
GGT;Gamma GT;جاما جي تي;CHEMISTRY;U/L;8;61;55;SER
TP;Total protein;البروتين الكلي;CHEMISTRY;g/dL;6;8.3;40;SER
ALB;Albumin;الألبومين;CHEMISTRY;g/dL;3.5;5.2;40;SER
GLOB;Globulin;الجلوبيولين;CHEMISTRY;g/dL;2;3.5;40;SER
LDH;Lactate dehydrogenase;LDH;CHEMISTRY;U/L;120;246;55;SER
CK;Creatine kinase;CK;CHEMISTRY;U/L;30;200;70;SER
CKMB;CK-MB;CK-MB;CHEMISTRY;U/L;0;25;90;SER
TROP;Troponin I;تروبونين;IMMUNOLOGY;ng/mL;0;0.04;260;SER
BNP;NT-proBNP;NT-proBNP;IMMUNOLOGY;pg/mL;0;125;480;SER
AMYL;Amylase;الأميليز;CHEMISTRY;U/L;28;100;70;SER
LIPA;Lipase;الليباز;CHEMISTRY;U/L;13;60;85;SER
CHOL;Cholesterol total;الكوليسترول;CHEMISTRY;mg/dL;0;200;45;SERF
TRIG;Triglycerides;الدهون الثلاثية;CHEMISTRY;mg/dL;0;150;45;SERF
HDLC;HDL cholesterol;الكوليسترول الجيد;CHEMISTRY;mg/dL;40;100;55;SERF
LDLD;LDL cholesterol (direct);الكوليسترول الضار;CHEMISTRY;mg/dL;0;130;60;SERF
APOA;Apolipoprotein A1;Apo A1;CHEMISTRY;mg/dL;110;180;180;SER
APOB;Apolipoprotein B;Apo B;CHEMISTRY;mg/dL;60;130;180;SER
LPA;Lipoprotein (a);Lp(a);CHEMISTRY;mg/dL;0;30;230;SER
CRP;C-reactive protein;بروتين سي التفاعلي;IMMUNOLOGY;mg/L;0;5;90;SER
HSCRP;hs-CRP;CRP عالي الحساسية;IMMUNOLOGY;mg/L;0;3;160;SER
PCT;Procalcitonin;بروكالسيتونين;IMMUNOLOGY;ng/mL;0;0.5;420;SER
RF;Rheumatoid factor;عامل الروماتويد;IMMUNOLOGY;IU/mL;0;14;110;SER
ASO;ASO titre;ASO;IMMUNOLOGY;IU/mL;0;200;100;SER
ANA;ANA (index);الأجسام المضادة للنواة;IMMUNOLOGY;index;0;1;260;SER
DSDNA;Anti-dsDNA;Anti-dsDNA;IMMUNOLOGY;IU/mL;0;30;300;SER
CCP;Anti-CCP;Anti-CCP;IMMUNOLOGY;U/mL;0;17;320;SER
C3;Complement C3;C3;IMMUNOLOGY;mg/dL;90;180;150;SER
C4;Complement C4;C4;IMMUNOLOGY;mg/dL;10;40;150;SER
IGG;Immunoglobulin G;IgG;IMMUNOLOGY;mg/dL;700;1600;160;SER
IGA;Immunoglobulin A;IgA;IMMUNOLOGY;mg/dL;70;400;160;SER
IGM;Immunoglobulin M;IgM;IMMUNOLOGY;mg/dL;40;230;160;SER
IGE;Total IgE;IgE;IMMUNOLOGY;IU/mL;0;100;180;SER
FT3;Free T3;T3 الحر;IMMUNOLOGY;pg/mL;2;4.4;130;SER
FT4;Free T4;T4 الحر;IMMUNOLOGY;ng/dL;0.8;1.8;130;SER
T3;Total T3;T3 الكلي;IMMUNOLOGY;ng/dL;80;200;120;SER
T4;Total T4;T4 الكلي;IMMUNOLOGY;ug/dL;5;12;120;SER
ATPO;Anti-TPO;Anti-TPO;IMMUNOLOGY;IU/mL;0;35;260;SER
ATG;Anti-thyroglobulin;Anti-TG;IMMUNOLOGY;IU/mL;0;40;260;SER
PTH;Parathyroid hormone;الباراثورمون;IMMUNOLOGY;pg/mL;15;65;260;SER
CORT;Cortisol (morning);الكورتيزول;IMMUNOLOGY;ug/dL;6;23;160;SER
ACTH;ACTH;ACTH;IMMUNOLOGY;pg/mL;7;63;300;EDTA
INS;Insulin (fasting);الإنسولين;IMMUNOLOGY;uIU/mL;2;25;170;SERF
CPEP;C-peptide;C-peptide;IMMUNOLOGY;ng/mL;0.8;3.5;240;SERF
FSH;FSH;FSH;IMMUNOLOGY;mIU/mL;1.5;12.4;120;SER
LH;LH;LH;IMMUNOLOGY;mIU/mL;1.7;8.6;120;SER
PRL;Prolactin;البرولاكتين;IMMUNOLOGY;ng/mL;4;25;120;SER
E2;Estradiol;الإستراديول;IMMUNOLOGY;pg/mL;20;350;130;SER
PROG;Progesterone;البروجسترون;IMMUNOLOGY;ng/mL;0.2;25;130;SER
TESTO;Testosterone total;التستوستيرون;IMMUNOLOGY;ng/dL;270;1070;140;SER
FTESTO;Testosterone free;التستوستيرون الحر;IMMUNOLOGY;pg/mL;5;21;230;SER
DHEAS;DHEA-S;DHEA-S;IMMUNOLOGY;ug/dL;35;430;180;SER
AMH;AMH;AMH;IMMUNOLOGY;ng/mL;1;10;520;SER
BHCG;Beta-hCG (quantitative);هرمون الحمل الكمي;IMMUNOLOGY;mIU/mL;0;5;120;SER
PSA;PSA total;PSA;IMMUNOLOGY;ng/mL;0;4;160;SER
FPSA;PSA free;PSA الحر;IMMUNOLOGY;ng/mL;0;1;180;SER
CEA;CEA;CEA;IMMUNOLOGY;ng/mL;0;5;180;SER
AFP;AFP;AFP;IMMUNOLOGY;ng/mL;0;10;180;SER
CA125;CA 125;CA 125;IMMUNOLOGY;U/mL;0;35;220;SER
CA153;CA 15-3;CA 15-3;IMMUNOLOGY;U/mL;0;30;220;SER
CA199;CA 19-9;CA 19-9;IMMUNOLOGY;U/mL;0;37;220;SER
HBSAG;HBs antigen (index);HBsAg;SEROLOGY;S/CO;0;1;100;SER
HBSAB;Anti-HBs;Anti-HBs;SEROLOGY;mIU/mL;10;1000;110;SER
HBCAB;Anti-HBc total;Anti-HBc;SEROLOGY;S/CO;0;1;110;SER
HCVAB;Anti-HCV (index);Anti-HCV;SEROLOGY;S/CO;0;1;110;SER
HIV;HIV Ag/Ab combo (index);HIV;SEROLOGY;S/CO;0;1;130;SER
HAVIGM;Hepatitis A IgM;التهاب الكبد A IgM;SEROLOGY;S/CO;0;1;140;SER
TOXOG;Toxoplasma IgG;توكسوبلازما IgG;SEROLOGY;IU/mL;0;3;140;SER
TOXOM;Toxoplasma IgM;توكسوبلازما IgM;SEROLOGY;index;0;0.5;140;SER
RUBG;Rubella IgG;الحصبة الألمانية IgG;SEROLOGY;IU/mL;10;500;140;SER
RUBM;Rubella IgM;الحصبة الألمانية IgM;SEROLOGY;index;0;0.8;140;SER
CMVG;CMV IgG;CMV IgG;SEROLOGY;AU/mL;0;6;150;SER
CMVM;CMV IgM;CMV IgM;SEROLOGY;index;0;0.7;150;SER
EBVG;EBV VCA IgG;EBV IgG;SEROLOGY;U/mL;0;20;160;SER
HSV1;HSV-1 IgG;هربس 1 IgG;SEROLOGY;index;0;0.9;150;SER
HSV2;HSV-2 IgG;هربس 2 IgG;SEROLOGY;index;0;0.9;150;SER
WIDAL;Widal (O titre);فيدال;SEROLOGY;titre;0;80;60;SER
BRUC;Brucella agglutination;بروسيلا;SEROLOGY;titre;0;80;80;SER
HPYAG;H. pylori antigen;هليكوباكتر (براز);SEROLOGY;index;0;1;140;STL
VDRL;VDRL (RPR);VDRL;SEROLOGY;titre;0;1;60;SER
TPHA;TPHA;TPHA;SEROLOGY;titre;0;80;80;SER
COVAB;SARS-CoV-2 IgG;كوفيد IgG;SEROLOGY;AU/mL;0;1;180;SER
NA24;Sodium (24h urine);صوديوم البول 24 ساعة;CHEMISTRY;mmol/24h;40;220;60;URN
K24;Potassium (24h urine);بوتاسيوم البول 24 ساعة;CHEMISTRY;mmol/24h;25;125;60;URN
CREA24;Creatinine (24h urine);كرياتينين البول 24 ساعة;CHEMISTRY;g/24h;0.8;2;60;URN
PROT24;Protein (24h urine);بروتين البول 24 ساعة;CHEMISTRY;mg/24h;0;150;60;URN
MALB;Microalbumin (urine);ميكروألبومين;CHEMISTRY;mg/L;0;30;110;URN
ACR;Albumin/creatinine ratio;نسبة الألبومين للكرياتينين;CHEMISTRY;mg/g;0;30;120;URN
UPH;Urine pH;pH البول;URINALYSIS;pH;4.5;8;15;URN
USG;Urine specific gravity;الكثافة النوعية;URINALYSIS;SG;1.005;1.03;15;URN
FERRI;Transferrin saturation (measured);تشبع الترانسفيرين;CHEMISTRY;%;20;50;70;SER
ZN;Zinc;الزنك;CHEMISTRY;ug/dL;60;120;120;SER
CU;Copper;النحاس;CHEMISTRY;ug/dL;70;140;120;SER
LI;Lithium;الليثيوم;CHEMISTRY;mmol/L;0.6;1.2;120;SER
DIGX;Digoxin;ديجوكسين;CHEMISTRY;ng/mL;0.8;2;170;SER
PHT;Phenytoin;فينيتوين;CHEMISTRY;ug/mL;10;20;170;SER
VPA;Valproic acid;حمض الفالبرويك;CHEMISTRY;ug/mL;50;100;170;SER
CBZ;Carbamazepine;كاربامازيبين;CHEMISTRY;ug/mL;4;12;170;SER
VANC;Vancomycin trough;فانكومايسين;CHEMISTRY;ug/mL;10;20;190;SER
CYA;Cyclosporine trough;سيكلوسبورين;IMMUNOLOGY;ng/mL;100;400;350;EDTA
TACRO;Tacrolimus trough;تاكروليموس;IMMUNOLOGY;ng/mL;5;15;350;EDTA
LAC;Lactate;اللاكتات;CHEMISTRY;mmol/L;0.5;2.2;110;FLU
AMM;Ammonia;الأمونيا;CHEMISTRY;ug/dL;15;45;140;EDTA
OSM;Osmolality (serum);الأسمولية;CHEMISTRY;mOsm/kg;275;295;90;SER
ABGPH;Blood gas pH;غازات الدم pH;CHEMISTRY;pH;7.35;7.45;130;HEP
PCO2;Blood gas pCO2;pCO2;CHEMISTRY;mmHg;35;45;0;HEP
PO2;Blood gas pO2;pO2;CHEMISTRY;mmHg;80;100;0;HEP
HCO3;Blood gas HCO3;HCO3;CHEMISTRY;mmol/L;22;26;0;HEP
G6PD;G6PD (quantitative);G6PD;HEMATOLOGY;U/gHb;4.6;13.5;170;EDTA
HBEL;Hb electrophoresis HbA2;الهيموجلوبين HbA2;HEMATOLOGY;%;1.5;3.5;260;EDTA
HBF;Foetal haemoglobin HbF;HbF;HEMATOLOGY;%;0;2;200;EDTA
SICK;Sickling test (index);اختبار الأنيميا المنجلية;HEMATOLOGY;index;0;0.5;90;EDTA
MALAR;Malaria parasite (per uL);طفيل الملاريا;HEMATOLOGY;/uL;0;0.5;110;EDTA
COOM;Coombs direct (titre);كومبس المباشر;HEMATOLOGY;titre;0;1;120;EDTA
CD4;CD4 count;CD4;HEMATOLOGY;cells/uL;500;1500;520;EDTA
ACT;Activated clotting time;ACT;COAGULATION;sec;80;130;70;CIT
FVIII;Factor VIII activity;عامل 8;COAGULATION;%;50;150;420;CIT
VWF;von Willebrand factor Ag;vWF;COAGULATION;%;50;160;420;CIT
PC;Protein C activity;بروتين C;COAGULATION;%;70;140;420;CIT
PS;Protein S activity;بروتين S;COAGULATION;%;60;140;420;CIT
AT3;Antithrombin III;AT III;COAGULATION;%;80;120;420;CIT
SPERM;Semen: sperm count;تعداد الحيوانات المنوية;GENERAL;M/mL;15;200;120;FLD
SPMOT;Semen: progressive motility;حركة الحيوانات المنوية;GENERAL;%;32;100;0;FLD
SPMOR;Semen: normal morphology;شكل الحيوانات المنوية;GENERAL;%;4;100;0;FLD
FPROT;CSF protein;بروتين السائل النخاعي;CHEMISTRY;mg/dL;15;45;80;FLD
FGLU;CSF glucose;سكر السائل النخاعي;CHEMISTRY;mg/dL;40;70;60;FLD
FWBC;CSF white cells;كريات السائل النخاعي;HEMATOLOGY;/uL;0;5;80;FLD
PLEUR;Pleural fluid protein;بروتين السائل الجنبي;CHEMISTRY;g/dL;0;3;80;FLD
ASCP;Ascitic fluid protein;بروتين الاستسقاء;CHEMISTRY;g/dL;0;3;80;FLD
SAAG;Serum-ascites albumin gradient;SAAG;CHEMISTRY;g/dL;0;1.1;80;FLD
OCCB;Stool occult blood (index);دم خفي في البراز;GENERAL;index;0;0.5;45;STL
CALPR;Faecal calprotectin;كالبروتكتين البراز;IMMUNOLOGY;ug/g;0;50;420;STL
PREGU;Pregnancy test (urine, index);اختبار حمل بول;GENERAL;index;0;0.5;40;URN
DRUGU;Urine drug screen (index);فحص مخدرات;GENERAL;index;0;0.5;180;URN
CULTAB;Culture sensitivity placeholder;مزرعة وحساسية;MICROBIOLOGY;score;0;1;0;SWB
`;

export interface Single { code: string; nameEn: string; nameAr: string; section: string; unit: string; low: number; high: number; price: number; spec: string }
export const SINGLES: Single[] = RAW.trim().split("\n").map((l) => {
  const [code, nameEn, nameAr, section, unit, low, high, price, spec] = l.split(";");
  return { code: code!, nameEn: nameEn!, nameAr: nameAr!, section: section!, unit: unit!, low: Number(low), high: Number(high), price: Number(price), spec: spec! };
}).filter((s) => s.code !== "CULTAB");

/** Multi-component panels and profiles (tests whose analytes already exist in the base starter catalogue or SINGLES). */
export const PANELS: { code: string; nameEn: string; nameAr: string; section: string; spec: string; price: number; tat: number; analytes: string[] }[] = [
  { code: "CBCD", nameEn: "CBC with differential", nameAr: "صورة دم مع التفريق", section: "HEMATOLOGY", spec: "EDTA", price: 170, tat: 120, analytes: ["HB", "WBC", "PLT", "RBC", "HCT", "MCV", "MCH", "MCHC", "RDW", "NEUT", "LYMP", "MONO", "EOS", "BASO"] },
  { code: "LIPID", nameEn: "Lipid profile", nameAr: "الدهون", section: "CHEMISTRY", spec: "SERF", price: 220, tat: 180, analytes: ["CHOL", "TRIG", "HDLC", "LDLD"] },
  { code: "RFT", nameEn: "Renal profile", nameAr: "وظائف الكلى الموسعة", section: "CHEMISTRY", spec: "SER", price: 230, tat: 180, analytes: ["CREA", "UREA", "UA", "K", "NA", "CL", "CA", "PHOS"].filter((x) => x !== "UA") },
  { code: "LFTX", nameEn: "Liver profile (extended)", nameAr: "وظائف الكبد الموسعة", section: "CHEMISTRY", spec: "SER", price: 280, tat: 180, analytes: ["ALT", "AST", "ALP", "GGT", "TBIL", "DBIL", "TP", "ALB"] },
  { code: "THYR", nameEn: "Thyroid profile", nameAr: "الغدة الدرقية", section: "IMMUNOLOGY", spec: "SER", price: 360, tat: 240, analytes: ["TSH", "FT3", "FT4"] },
  { code: "IRONP", nameEn: "Iron profile", nameAr: "دراسة الحديد", section: "CHEMISTRY", spec: "SER", price: 260, tat: 240, analytes: ["IRON", "TIBC", "FERR"] },
  { code: "COAG", nameEn: "Coagulation screen", nameAr: "اختبارات التجلط", section: "COAGULATION", spec: "CIT", price: 220, tat: 120, analytes: ["PT", "INR", "APTT"] },
  { code: "ELEC", nameEn: "Electrolytes", nameAr: "الأملاح", section: "CHEMISTRY", spec: "SER", price: 110, tat: 120, analytes: ["NA", "K", "CL", "BICARB"] },
  { code: "BONE", nameEn: "Bone profile", nameAr: "العظام", section: "CHEMISTRY", spec: "SER", price: 190, tat: 180, analytes: ["CA", "PHOS", "ALP", "VITD"] },
  { code: "CARD", nameEn: "Cardiac markers", nameAr: "إنزيمات القلب", section: "CHEMISTRY", spec: "SER", price: 330, tat: 120, analytes: ["TROP", "CKMB", "CK", "LDH"] },
  { code: "DIAB", nameEn: "Diabetes panel", nameAr: "متابعة السكر", section: "CHEMISTRY", spec: "SERF", price: 260, tat: 180, analytes: ["GLU", "INS"] },
  { code: "PCOS", nameEn: "PCOS hormone panel", nameAr: "هرمونات تكيس المبايض", section: "IMMUNOLOGY", spec: "SER", price: 520, tat: 360, analytes: ["FSH", "LH", "PRL", "TESTO", "DHEAS", "AMH"] },
  { code: "FERT", nameEn: "Fertility hormones (female)", nameAr: "هرمونات الخصوبة", section: "IMMUNOLOGY", spec: "SER", price: 430, tat: 360, analytes: ["FSH", "LH", "E2", "PROG", "PRL", "AMH"] },
  { code: "ANTEN", nameEn: "Antenatal screen", nameAr: "متابعة الحمل", section: "SEROLOGY", spec: "SER", price: 560, tat: 480, analytes: ["HBSAG", "HCVAB", "HIV", "RUBG", "TOXOG", "VDRL"] },
  { code: "HEPB", nameEn: "Hepatitis B profile", nameAr: "التهاب الكبد B", section: "SEROLOGY", spec: "SER", price: 320, tat: 360, analytes: ["HBSAG", "HBSAB", "HBCAB"] },
  { code: "TORCH", nameEn: "TORCH screen", nameAr: "TORCH", section: "SEROLOGY", spec: "SER", price: 640, tat: 480, analytes: ["TOXOG", "TOXOM", "RUBG", "RUBM", "CMVG", "CMVM", "HSV2"] },
  { code: "ARTH", nameEn: "Arthritis panel", nameAr: "الروماتيزم", section: "IMMUNOLOGY", spec: "SER", price: 420, tat: 360, analytes: ["RF", "ASO", "CRP", "CCP", "ANA"] },
  { code: "ANEM", nameEn: "Anaemia profile", nameAr: "الأنيميا", section: "HEMATOLOGY", spec: "EDTA", price: 340, tat: 240, analytes: ["HB", "MCV", "RETIC", "FERR", "B12", "FOL"] },
  { code: "TUMM", nameEn: "Tumour markers (male)", nameAr: "دلالات الأورام للرجال", section: "IMMUNOLOGY", spec: "SER", price: 520, tat: 360, analytes: ["PSA", "FPSA", "CEA", "AFP"] },
  { code: "TUMF", nameEn: "Tumour markers (female)", nameAr: "دلالات الأورام للسيدات", section: "IMMUNOLOGY", spec: "SER", price: 640, tat: 360, analytes: ["CA125", "CA153", "CEA", "AFP"] },
  { code: "URINE", nameEn: "Urine analysis (physical + chemical)", nameAr: "تحليل بول كامل", section: "URINALYSIS", spec: "URN", price: 60, tat: 90, analytes: ["UPH", "USG", "UPRO"] },
  { code: "SEMEN", nameEn: "Semen analysis", nameAr: "تحليل السائل المنوي", section: "GENERAL", spec: "FLD", price: 220, tat: 180, analytes: ["SPERM", "SPMOT", "SPMOR"] },
  { code: "CSF", nameEn: "CSF profile", nameAr: "السائل النخاعي", section: "CHEMISTRY", spec: "FLD", price: 220, tat: 180, analytes: ["FPROT", "FGLU", "FWBC"] },
  { code: "PREOP", nameEn: "Pre-operative screen", nameAr: "تحاليل ما قبل الجراحة", section: "HEMATOLOGY", spec: "EDTA", price: 330, tat: 240, analytes: ["HB", "WBC", "PLT", "PT", "INR"] },
  { code: "EGFR", nameEn: "Renal function with eGFR", nameAr: "وظائف الكلى مع eGFR", section: "CHEMISTRY", spec: "SER", price: 210, tat: 180, analytes: ["CREA", "UREA", "EGFR"] },
];

export const PACKAGES: { code: string; nameEn: string; nameAr: string; price: number; tests: string[] }[] = [
  { code: "EXEC", nameEn: "Executive check-up", nameAr: "الفحص الشامل التنفيذي", price: 1450, tests: ["CBCD", "LIPID", "RFT", "LFTX", "THYR", "HBA1C", "VITD"] },
  { code: "WOMEN", nameEn: "Women's health", nameAr: "صحة المرأة", price: 1180, tests: ["CBCD", "THYR", "IRONP", "VITD", "FERT"] },
  { code: "MEN", nameEn: "Men's health", nameAr: "صحة الرجل", price: 1090, tests: ["CBCD", "LIPID", "TUMM", "VITD", "TESTO"] },
  { code: "DIABP", nameEn: "Diabetes follow-up", nameAr: "متابعة السكري", price: 520, tests: ["DIAB", "HBA1C", "RFT", "MALB"] },
  { code: "PRENAT", nameEn: "Prenatal package", nameAr: "باقة الحمل", price: 980, tests: ["CBCD", "ANTEN", "THYR", "GLUR"] },
  { code: "STUD", nameEn: "Student / pre-employment", nameAr: "فحص طلابي", price: 420, tests: ["CBCD", "HBSAG", "HCVAB", "URINE"] },
];
