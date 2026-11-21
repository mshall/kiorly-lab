export type Locale = "en" | "ar";
interface T { subject?: string; text: string }

/**
 * Placeholder bodies for every template id (TODO_NEEDS_HUMAN, NH-LB-018: approved EN + AR wording and Meta template names).
 * Same rendering path in mock and real. NEVER put result values in a template (KLCRIT03): order numbers, ids and links only.
 */
export const MESSAGE_TEMPLATES: Record<string, { en: T; ar: T }> = {
  TODO_NEEDS_HUMAN_REPORT_DELIVERY: { en: { subject: "Your lab report is ready", text: "Your lab report for order {orderNumber} is ready. Open it securely: {link}" }, ar: { subject: "تقريرك المعملي جاهز", text: "تقرير التحاليل للطلب {orderNumber} جاهز. افتحه بأمان: {link}" } },
  TODO_NEEDS_HUMAN_RESULT_READY: { en: { subject: "Your lab report is ready", text: "Your lab report for order {orderNumber} is ready. Open it securely: {link}" }, ar: { subject: "تقريرك المعملي جاهز", text: "تقرير التحاليل للطلب {orderNumber} جاهز. افتحه بأمان: {link}" } },
  TODO_NEEDS_HUMAN_REPORT_CORRECTED: { en: { subject: "Corrected lab report", text: "A corrected report for order {orderNumber} is available. Please use the new version: {link}" }, ar: { subject: "تقرير معملي مصحح", text: "تم إصدار تقرير مصحح للطلب {orderNumber}. يرجى استخدام النسخة الجديدة: {link}" } },
  TODO_NEEDS_HUMAN_REPORT_OTP: { en: { text: "Your Kiorly Lab verification code is {otp}. Do not share it." }, ar: { text: "رمز التحقق الخاص بك في كيورلي لاب هو {otp}. لا تشاركه مع أحد." } },
  TODO_NEEDS_HUMAN_CRITICAL_ALERT: { en: { subject: "Critical result needs attention", text: "Kiorly Lab: order {orderNumber} has a result that needs urgent clinical attention. Please contact the laboratory now." }, ar: { subject: "نتيجة حرجة تحتاج إلى انتباه", text: "كيورلي لاب: الطلب {orderNumber} يحتوي على نتيجة تحتاج إلى انتباه سريري عاجل. يرجى التواصل مع المعمل الآن." } },
  TODO_NEEDS_HUMAN_CRITICAL_ESCALATION: { en: { subject: "Critical result escalated", text: "Kiorly Lab: order {orderNumber} critical result was not acknowledged in time (level {level})." }, ar: { subject: "تصعيد نتيجة حرجة", text: "كيورلي لاب: لم يتم الإقرار بالنتيجة الحرجة للطلب {orderNumber} في الوقت المحدد (المستوى {level})." } },
  TODO_NEEDS_HUMAN_RECOLLECTION_NOTICE: { en: { subject: "A new sample is needed", text: "Kiorly Lab: order {orderNumber} needs a new sample. Please contact us to arrange it." }, ar: { subject: "مطلوب عينة جديدة", text: "كيورلي لاب: الطلب {orderNumber} يحتاج إلى عينة جديدة. يرجى التواصل معنا للترتيب." } },
  TODO_NEEDS_HUMAN_COLLECTION_REMINDER: { en: { text: "Reminder: your home sample collection is scheduled for {slotStart}." }, ar: { text: "تذكير: موعد سحب العينة من المنزل في {slotStart}." } },
  TODO_NEEDS_HUMAN_SLA_ALERT: { en: { text: "Order {orderNumber} ({test}) exceeded its target turnaround time." }, ar: { text: "الطلب {orderNumber} ({test}) تجاوز الزمن المستهدف." } },
  TODO_NEEDS_HUMAN_SAFETY_PROMPT: { en: { text: "Safety check-in prompt for a home collection." }, ar: { text: "طلب تأكيد سلامة لزيارة سحب منزلية." } },
  TODO_NEEDS_HUMAN_SAFETY_ALERT: { en: { subject: "Collector safety alert", text: "A home-collection safety alert was raised. Check in with the collector now." }, ar: { subject: "تنبيه سلامة لأخصائي السحب", text: "تم رفع تنبيه سلامة لزيارة سحب منزلية. تواصل مع أخصائي السحب الآن." } },
  TODO_NEEDS_HUMAN_INVOICE_EMAIL: { en: { subject: "Your invoice {invoiceNumber}", text: "Invoice {invoiceNumber}: total {total} {currency}, outstanding {outstanding} {currency}." }, ar: { subject: "فاتورتك {invoiceNumber}", text: "الفاتورة {invoiceNumber}: الإجمالي {total} {currency}، المتبقي {outstanding} {currency}." } },
  TODO_NEEDS_HUMAN_PAYMENT_RECEIPT: { en: { subject: "Payment receipt {invoiceNumber}", text: "We received your payment of {amount} {currency} for invoice {invoiceNumber}. Thank you." }, ar: { subject: "إيصال دفع {invoiceNumber}", text: "استلمنا دفعتك بقيمة {amount} {currency} للفاتورة {invoiceNumber}. شكراً لك." } },
  TODO_NEEDS_HUMAN_PAYMENT_LINK: { en: { subject: "Pay invoice {invoiceNumber}", text: "Pay {amount} {currency} for invoice {invoiceNumber} securely: {link}" }, ar: { subject: "ادفع الفاتورة {invoiceNumber}", text: "ادفع {amount} {currency} للفاتورة {invoiceNumber} بأمان: {link}" } },
};

const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(p[k] ?? `{${k}}`));

export function renderMessage(templateId: string, params: Record<string, string | number> = {}, locale: Locale = "en"): { subject?: string; text: string } {
  const t = MESSAGE_TEMPLATES[templateId];
  if (!t) return { text: `Kiorly Lab notification (${templateId})` };
  const l = t[locale] ?? t.en;
  return { subject: l.subject ? fill(l.subject, params) : undefined, text: fill(l.text, params) };
}
