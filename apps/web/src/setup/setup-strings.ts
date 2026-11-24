import i18n from "@/lib/i18n";

/** Quick-setup strings live beside the feature (merged into the app bundle at runtime) so the shared locale files stay untouched. */
const EN = {
  "title": "Welcome — quick setup",
  "subtitle": "Finish these steps to start working. Each one opens the exact screen and ticks itself when done.",
  "subtitleDone": "Everything is set up.",
  "expand": "Show steps",
  "collapse": "Hide steps",
  "progress": "Setup progress",
  "progressCount": "{{done}} of {{total}} done · {{percent}}%",
  "aggregate": "{{done}} of {{total}}",
  "showEntities": "Show {{count}}",
  "hideEntities": "Hide list",
  "start": "Start",
  "open": "Open",
  "done": "Done",
  "skipped": "Skipped",
  "skip": "Skip",
  "optional": "optional",
  "askOwner": "Ask the owner.",
  "whoCan": "Can be done by: {{roles}}.",
  "autoDetect": "Detected automatically from your data, no ticking needed.",
  "completeTitle": "You're all set",
  "completeBody": "Your organisation is fully set up. You can revisit any screen from the menu at any time.",
  "dismiss": "Dismiss",
  "bar": {
    "region": "Quick setup",
    "stepOf": "Step {{n}} of {{total}}",
    "back": "Back to checklist",
    "skipForNow": "Skip for now",
    "doneReturning": "Done. Taking you back to the checklist...",
    "alreadyDone": "This step is already done."
  },
  "steps": {
    "lab_licence": "Add the lab licence and address",
    "starter_catalogue": "Load your test catalogue",
    "signatory": "Add an authorised signatory with a licence",
    "invite_staff": "Add a team member",
    "lab_coverage": "Set home-collection districts",
    "safety_contact": "Add a safety contact",
    "first_order": "Create your first order",
    "first_report": "Release your first report",
    "connect_kiorex": "Connect to Kiorex"
  },
  "why": {
    "lab_licence": "The licence number and address print on reports.",
    "starter_catalogue": "Load the starter tests, or import your own catalogue.",
    "signatory": "Reports can only be signed by a licensed signatory.",
    "invite_staff": "Add a technologist, receptionist or phlebotomist.",
    "lab_coverage": "The districts this lab collects samples in.",
    "safety_contact": "A phone number alerted if a collector raises a safety concern.",
    "first_order": "Register a patient and create a lab order.",
    "first_report": "Run a result through validation and release the report.",
    "connect_kiorex": "Optional. Let patients find and book you on Kiorex."
  },
  "roles": {
    "OWNER": "Owner",
    "LAB_DIRECTOR": "Lab director",
    "AUTHORIZED_SIGNATORY": "Authorised signatory",
    "TECHNOLOGIST": "Technologist",
    "PHLEBOTOMIST": "Phlebotomist",
    "RECEPTION": "Reception",
    "BRANCH_MANAGER": "Branch manager",
    "SUPERVISOR": "Supervisor",
    "FINANCE": "Finance"
  }
};
const AR = {
  "title": "مرحبًا — الإعداد السريع",
  "subtitle": "أكمل هذه الخطوات لتبدأ العمل. كل خطوة تفتح الشاشة المناسبة وتكتمل تلقائيًا.",
  "subtitleDone": "كل شيء جاهز.",
  "expand": "عرض الخطوات",
  "collapse": "إخفاء الخطوات",
  "progress": "تقدم الإعداد",
  "progressCount": "{{done}} من {{total}} · {{percent}}٪",
  "aggregate": "{{done}} من {{total}}",
  "showEntities": "عرض {{count}}",
  "hideEntities": "إخفاء القائمة",
  "start": "ابدأ",
  "open": "افتح",
  "done": "تم",
  "skipped": "تم التخطي",
  "skip": "تخطَّ",
  "optional": "اختياري",
  "askOwner": "اطلب من المالك.",
  "whoCan": "يمكن تنفيذها بواسطة: {{roles}}.",
  "autoDetect": "تُكتشف تلقائيًا من بياناتك دون تحديد يدوي.",
  "completeTitle": "كل شيء جاهز",
  "completeBody": "تم إعداد مؤسستك بالكامل. يمكنك العودة إلى أي شاشة من القائمة في أي وقت.",
  "dismiss": "إخفاء",
  "bar": {
    "region": "الإعداد السريع",
    "stepOf": "الخطوة {{n}} من {{total}}",
    "back": "العودة إلى القائمة",
    "skipForNow": "تخطَّ الآن",
    "doneReturning": "تم. نعيدك إلى قائمة الإعداد...",
    "alreadyDone": "هذه الخطوة مكتملة بالفعل."
  },
  "steps": {
    "lab_licence": "أضف ترخيص المعمل وعنوانه",
    "starter_catalogue": "حمّل كتالوج التحاليل",
    "signatory": "أضف موقّعًا معتمدًا برقم ترخيص",
    "invite_staff": "أضف عضوًا في الفريق",
    "lab_coverage": "حدد أحياء السحب المنزلي",
    "safety_contact": "أضف جهة اتصال للسلامة",
    "first_order": "أنشئ أول طلب",
    "first_report": "أصدر أول تقرير",
    "connect_kiorex": "الربط مع كيوريكس"
  },
  "why": {
    "lab_licence": "رقم الترخيص والعنوان يُطبعان على التقارير.",
    "starter_catalogue": "حمّل التحاليل الأساسية أو استورد كتالوجك.",
    "signatory": "لا يمكن توقيع التقارير إلا بواسطة موقّع مرخّص.",
    "invite_staff": "أضف فنيًا أو موظف استقبال أو أخصائي سحب.",
    "lab_coverage": "الأحياء التي يسحب منها هذا المعمل.",
    "safety_contact": "رقم هاتف نُنبّهه عند وجود قلق على سلامة القائم بالسحب.",
    "first_order": "سجّل مريضًا وأنشئ طلب تحاليل.",
    "first_report": "أدخل نتيجة واعتمدها ثم أصدر التقرير.",
    "connect_kiorex": "اختياري. دع المرضى يجدونك ويحجزون عندك عبر كيوريكس."
  },
  "roles": {
    "OWNER": "المالك",
    "LAB_DIRECTOR": "مدير المعمل",
    "AUTHORIZED_SIGNATORY": "الموقّع المعتمد",
    "TECHNOLOGIST": "الفني",
    "PHLEBOTOMIST": "أخصائي السحب",
    "RECEPTION": "الاستقبال",
    "BRANCH_MANAGER": "مدير الفرع",
    "SUPERVISOR": "المشرف",
    "FINANCE": "المالية"
  }
};
i18n.addResourceBundle("en", "translation", { setup: EN }, true, true);
i18n.addResourceBundle("ar", "translation", { setup: AR }, true, true);
