import { Inject, Injectable, Logger } from "@nestjs/common";
import type { StaffRole } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Db } from "../common/db";
import { ProviderError, type FetchLike } from "../providers/http";
import { providerConfig, providerMode } from "../providers/provider-env";
import { sendPush } from "../providers/push-provider";

export type MobileKind = "GENERAL" | "SAFETY" | "CLINICAL" | "OPS";

interface Template {
  kind: MobileKind;
  title: string;
  titleAr: string;
  body: string;
  bodyAr: string;
}

/** Bilingual templates. NO raw result values or clinical data (KLCRIT03): order numbers and ids only. TODO_NEEDS_HUMAN: final wording (NH-LB-018). */
export const MOBILE_TEMPLATES: Record<string, Template> = {
  CRITICAL_ALERT: { kind: "SAFETY", title: "Critical result needs acknowledgement", titleAr: "نتيجة حرجة تحتاج إلى إقرار", body: "Order {orderNumber} has a critical result. Acknowledge it now.", bodyAr: "الطلب {orderNumber} يحتوي على نتيجة حرجة. يرجى الإقرار الآن." },
  CRITICAL_ESCALATION: { kind: "SAFETY", title: "Critical result escalated", titleAr: "تصعيد نتيجة حرجة", body: "Order {orderNumber} was not acknowledged in time (level {level}).", bodyAr: "لم يتم الإقرار بالطلب {orderNumber} في الوقت المحدد (المستوى {level})." },
  SLA_ALERT: { kind: "OPS", title: "Turnaround time breached", titleAr: "تجاوز زمن إصدار النتيجة", body: "Order {orderNumber} ({test}) exceeded its target turnaround time.", bodyAr: "الطلب {orderNumber} ({test}) تجاوز الزمن المستهدف." },
  SAFETY_ALERT: { kind: "SAFETY", title: "Collector safety alert", titleAr: "تنبيه سلامة لأخصائي السحب", body: "A home-collection safety alert was raised. Check in with the collector.", bodyAr: "تم رفع تنبيه سلامة لزيارة سحب منزلية. تواصل مع أخصائي السحب." },
  RESULT_AWAITING_VALIDATION: { kind: "CLINICAL", title: "Results awaiting sign-off", titleAr: "نتائج بانتظار الاعتماد", body: "Order {orderNumber} is ready for medical validation.", bodyAr: "الطلب {orderNumber} جاهز للاعتماد الطبي." },
  REAGENT_LOW_STOCK: { kind: "OPS", title: "Reagent stock is low", titleAr: "مخزون كاشف منخفض", body: "{item} has no usable stock for the latest run.", bodyAr: "لا يوجد مخزون صالح من {item} للتشغيل الأخير." },
  UPGRADE_REQUEST: { kind: "OPS", title: "Staff asked to upgrade Kiorly Team", titleAr: "طلب موظف ترقية Kiorly Team", body: "A team member asked for the Kiorly Team staff app (Pro plan). Review your plan in Settings.", bodyAr: "طلب أحد أعضاء الفريق تطبيق Kiorly Team للموظفين (باقة Pro). راجع باقتك من الإعدادات." },
  TEST: { kind: "GENERAL", title: "Kiorly Team test notification", titleAr: "إشعار تجريبي من Kiorly Team", body: "Push is working on this device.", bodyAr: "الإشعارات تعمل على هذا الجهاز." },
};

const FORBIDDEN = /value|result|analyte|diagnosis|mmol|mg\/dl|g\/dl/i;
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(p[k] ?? ""));

const PURPOSE_TEMPLATE: Record<string, string> = { CRITICAL_ALERT: "CRITICAL_ALERT", CRITICAL_ESCALATION: "CRITICAL_ESCALATION", SLA_ALERT: "SLA_ALERT", SAFETY_ALERT: "SAFETY_ALERT" };

/**
 * Kiorly Team push sender. PUSH_MODE (legacy MOBILE_PUSH_MODE)=mock (default): stores the message (= the in-app inbox), marks it DELIVERED and, when the
 * recipient has registered devices with a push token, simulates the provider hand-off. real: Expo-compatible push gateway (PUSH_API_URL / PUSH_API_KEY).
 */
@Injectable()
export class MobilePushService {
  private readonly log = new Logger(MobilePushService.name);
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Test seam for the real push gateway. */
  static fetchImpl?: FetchLike;

  static mode(): "mock" | "real" {
    return providerMode("PUSH");
  }

  async send(input: { orgId: string; staffId: string; templateId: string; params?: Record<string, string | number>; data?: Record<string, unknown> }, db: Db = this.prisma) {
    const tpl = MOBILE_TEMPLATES[input.templateId];
    if (!tpl) throw new Error(`unknown mobile push template ${input.templateId}`);
    const params = input.params ?? {};
    for (const [k, v] of Object.entries(params)) {
      if (FORBIDDEN.test(k) || (typeof v === "string" && /\d+(\.\d+)?\s?(mmol|mg\/dl|g\/dl|x10)/i.test(v))) throw new Error(`mobile push param "${k}" looks like a raw result value`);
    }
    const real = MobilePushService.mode() === "real";
    if (real && !providerConfig("PUSH").apiUrl) throw new ProviderError("NOT_CONFIGURED", "PUSH_API_URL is not set (PUSH_MODE=real)");
    const now = new Date();
    // The in-app inbox row is always written (it is the inbox). Real mode additionally hands the message to the push gateway for registered devices.
    const row = await db.mobilePush.create({
      data: { orgId: input.orgId, staffId: input.staffId, kind: tpl.kind, templateId: input.templateId, title: fill(tpl.title, params), titleAr: fill(tpl.titleAr, params), body: fill(tpl.body, params), bodyAr: fill(tpl.bodyAr, params), data: (input.data ?? {}) as never, status: real ? "SENT" : "DELIVERED", provider: real ? "push" : "mock", deliveredAt: real ? null : now },
    });
    if (real) {
      const tokens = (await db.mobileDevice.findMany({ where: { orgId: input.orgId, staffId: input.staffId, status: "ACTIVE", pushToken: { not: null } }, select: { pushToken: true } })).map((d) => d.pushToken!).filter(Boolean);
      try {
        if (tokens.length) await sendPush(tokens.map((to) => ({ to, title: row.title, body: row.body, data: { ...(input.data ?? {}), pushId: row.id } })), process.env, MobilePushService.fetchImpl);
      } catch (e) {
        this.log.warn(`push gateway failed (${e instanceof ProviderError ? e.code : "UNEXPECTED"}) for inbox ${row.id}`);
        await db.mobilePush.update({ where: { id: row.id }, data: { status: "FAILED" } });
      }
    }
    return row;
  }

  /** Push to every active staff member holding one of the roles. Never throws (informational). */
  async notifyRoles(orgId: string, roles: StaffRole[], templateId: string, params: Record<string, string | number>, data: Record<string, unknown>, db: Db = this.prisma): Promise<number> {
    try {
      const staff = await db.staffUser.findMany({ where: { orgId, role: { in: roles }, active: true }, select: { id: true } });
      for (const s of staff) await this.send({ orgId, staffId: s.id, templateId, params, data }, db);
      return staff.length;
    } catch (e) {
      this.log.warn(`mobile push skipped: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Called by MessagingAdapter for PUSH-channel sends so existing safety/ops notifications also land in the app inbox. */
  async mirror(input: { orgId: string; recipientRef: string; purpose: string; params?: Record<string, string | number>; relatedType?: string; relatedId?: string }, db: Db = this.prisma): Promise<void> {
    const templateId = PURPOSE_TEMPLATE[input.purpose];
    if (!templateId) return;
    try {
      const staff = await db.staffUser.findFirst({ where: { id: input.recipientRef, orgId: input.orgId, active: true }, select: { id: true } });
      if (!staff) return;
      const alertKey = input.relatedType === "CriticalAlert" ? `crit_${input.relatedId}` : input.relatedType === "OrderItem" ? `tat_${input.relatedId}` : undefined;
      await this.send({ orgId: input.orgId, staffId: staff.id, templateId, params: input.params, data: { relatedType: input.relatedType, relatedId: input.relatedId, alertKey, deepLink: alertKey ? `kiorlyteam://lab/alerts/${alertKey}` : undefined } }, db);
    } catch (e) {
      this.log.warn(`mobile push mirror skipped: ${(e as Error).message}`);
    }
  }
}

