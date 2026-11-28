import i18n from "@/lib/i18n";

/** Top bar wording (organisation chip with plan, "Find a test for a patient"), merged at runtime under `topbar`. */
const EN = {
  "plan": "Plan", "planHint": "Your organisation's current Kiorly plan",
  "findTest": "Find a test for a patient", "dialogTitle": "Find a test for a patient", "hint": "Type at least 2 letters of the test name or its code, then start an order for a patient.",
  "placeholder": "Test name or code", "none": "No test matches this search.", "failed": "The test list could not load. Try again.", "loading": "Loading tests",
  "specimen": "Specimen", "container": "Container", "turnaround": "Turnaround", "price": "Price", "fasting": "Fasting needed", "minutes": "{{count}} min", "hours": "{{count}} h",
  "orderFor": "Order for a patient", "openCatalogue": "Open in the catalogue", "shortcut": "Shortcut: Ctrl or Cmd + K",
};
const AR = {
  "plan": "الخطة", "planHint": "خطة كيورلي الحالية لمؤسستك",
  "findTest": "ابحث عن تحليل لمريض", "dialogTitle": "ابحث عن تحليل لمريض", "hint": "اكتب حرفين على الأقل من اسم التحليل أو رمزه، ثم ابدأ طلبا لمريض.",
  "placeholder": "اسم التحليل أو رمزه", "none": "لا يوجد تحليل مطابق لهذا البحث.", "failed": "تعذر تحميل قائمة التحاليل. حاول مرة أخرى.", "loading": "جارٍ تحميل التحاليل",
  "specimen": "العينة", "container": "الوعاء", "turnaround": "مدة الإنجاز", "price": "السعر", "fasting": "يتطلب صياما", "minutes": "{{count}} دقيقة", "hours": "{{count}} ساعة",
  "orderFor": "اطلب لمريض", "openCatalogue": "افتح في الكتالوج", "shortcut": "اختصار: Ctrl أو Cmd + K",
};
i18n.addResourceBundle("en", "translation", { "topbar": EN }, true, false);
i18n.addResourceBundle("ar", "translation", { "topbar": AR }, true, false);
export const topbarStrings = { EN, AR };
