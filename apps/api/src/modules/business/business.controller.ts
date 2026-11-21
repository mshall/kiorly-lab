import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Put, Query, Res, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { RequiresFlag } from "../../feature-flags/requires-flag.guard";
import { BillingService } from "./billing.service";
import { PayLinksService } from "./paylinks.service";
import { EXPORT_KINDS, ExportsService, type ExportKind } from "./exports.service";
import { InsightsService } from "./insights.service";
import { FinanceService } from "./finance.service";
import { renderTablePdf } from "../../common/table-pdf";
import { BadRequestException } from "@nestjs/common";

const num = z.coerce.number();
const PriceList = z.object({ name: z.string().min(1), isDefault: z.boolean().optional() }).strict();
const Price = z.object({ testId: z.string().optional(), packageId: z.string().optional(), amount: num.nonnegative() }).strict();
const Account = z.object({
  name: z.string().min(1), priceListId: z.string().optional(), paymentTermsDays: z.number().int().min(0).max(365).optional(), creditLimit: num.nonnegative().optional(),
  kind: z.enum(["CORPORATE", "INSURANCE"]).optional(), discountPercent: num.min(0).max(100).optional(), coveragePercent: num.min(0).max(100).optional(), contractRef: z.string().max(60).nullable().optional(),
  contractStart: z.string().optional(), contractEnd: z.string().optional(), billingEmail: z.string().email().nullable().optional(),
}).strict();
const AccountPatch = Account.partial().extend({ active: z.boolean().optional() }).strict();
const InvoiceBody = z.object({ discountPercent: num.min(0).max(100).optional(), discountAmount: num.nonnegative().optional(), reason: z.string().max(200).optional() }).strict();
const PayLinkBody = z.object({ amount: num.positive().optional(), expiresInHours: z.number().int().min(1).max(24 * 30).optional(), sendVia: z.object({ channel: z.enum(["SMS", "EMAIL", "WHATSAPP"]), to: z.string().min(3).max(120).optional() }).strict().optional() }).strict();
const SendDocBody = z.object({ kind: z.enum(["INVOICE", "RECEIPT"]), channel: z.enum(["SMS", "EMAIL", "WHATSAPP"]).default("EMAIL"), to: z.string().min(3).max(120).optional() }).strict();
const RefundBody = z.object({ amount: num.positive().optional(), reason: z.string().max(200).optional() }).strict();
const ExpenseBody = z.object({ labId: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), category: z.enum(["RENT", "SALARIES", "UTILITIES", "REAGENTS", "CONSUMABLES", "EQUIPMENT", "MAINTENANCE", "TRANSPORT", "MARKETING", "PROFESSIONAL_FEES", "OTHER"]), amount: num.positive(), vendor: z.string().max(120).optional(), paidVia: z.enum(["CASH", "BANK", "CARD"]).optional(), fromDrawer: z.boolean().optional(), reference: z.string().max(60).optional(), note: z.string().max(300).optional() }).strict();
const VoidExpense = z.object({ reason: z.string().min(3).max(200) }).strict();
const Pay = z.object({ method: z.enum(["CASH", "CARD", "TRANSFER", "CHEQUE"]), amount: num.positive(), cardToken: z.string().optional(), payer: z.enum(["PATIENT", "PAYER"]).optional(), reference: z.string().max(60).optional() }).strict();
const Void = z.object({ reason: z.string().min(1).max(300) }).strict();
const Close = z.object({ labId: z.string().optional(), businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), countedCash: num.nonnegative(), note: z.string().max(300).optional() }).strict();
const SendOut = z.object({ referralLabName: z.string().min(1), cost: num.nonnegative() }).strict();

@ApiTags("business")
@ApiBearerAuth()
@Controller()
export class BusinessController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(InsightsService) private readonly insights: InsightsService,
    @Inject(ExportsService) private readonly exports: ExportsService,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(PayLinksService) private readonly payLinks: PayLinksService,
  ) {}

  @Get("price-lists") @Perm("billing.read") priceLists(@CurrentUser() u: AuthUser) { return this.billing.listPriceLists(u.orgId); }
  @Post("price-lists") @Perm("billing.pricing") @RequiresFlag("lab.module") @ZBody(PriceList) createPl(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof PriceList>) { return this.billing.createPriceList(u, b); }
  @Get("price-lists/:id/items") @Perm("billing.read") plItems(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.billing.priceListItems(u.orgId, id); }
  @Put("price-lists/:id/prices") @Perm("billing.pricing") @RequiresFlag("lab.module") @ZBody(Price) setPrice(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Price>) { return this.billing.setPrice(u, id, b); }
  @Get("b2b-accounts") @Perm("billing.read") accounts(@CurrentUser() u: AuthUser) { return this.billing.listAccounts(u.orgId); }
  @Post("b2b-accounts") @Perm("billing.pricing") @RequiresFlag("lab.module") @ZBody(Account) createAccount(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Account>) { return this.billing.createAccount(u, b); }
  @Put("b2b-accounts/:id") @Perm("billing.pricing") @ZBody(AccountPatch) updateAccount(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof AccountPatch>) { return this.billing.updateAccount(u, id, b); }

  @Get("invoices") @Perm("billing.read") invoices(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.billing.listInvoices(u, q); }
  @Get("invoices/:id") @Perm("billing.read") invoice(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.billing.getInvoice(u.orgId, id); }
  @Post("orders/:orderId/invoice") @Perm("billing.invoice") @RequiresFlag("lab.module") @ZBody(InvoiceBody) invoiceOrder(@CurrentUser() u: AuthUser, @Param("orderId") orderId: string, @Body() b: z.infer<typeof InvoiceBody>) { return this.billing.invoiceOrder(u, orderId, b); }
  @Post("invoices/:id/void") @Perm("billing.invoice") @ZBody(Void) voidInvoice(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Void>) { return this.billing.voidInvoice(u, id, b.reason); }
  @Post("invoices/:id/payments") @Perm("billing.payment") @ZBody(Pay) pay(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Pay>, @Headers("idempotency-key") key?: string) { return this.billing.pay(u, id, b, key); }
  @Post("payments/:id/refund") @Perm("billing.payment") @ZBody(RefundBody) refund(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof RefundBody>) { return this.billing.refund(u, id, b); }
  @Post("invoices/:id/pay-link") @Perm("billing.payment") @ZBody(PayLinkBody) payLink(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof PayLinkBody>, @Headers("idempotency-key") key?: string) { return this.payLinks.create(u, id, b, key); }
  @Get("invoices/:id/pay-links") @Perm("billing.read") payLinksFor(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.payLinks.list(u.orgId, id); }
  @Post("pay-links/:id/refund") @Perm("billing.payment") @ZBody(RefundBody) refundPayLink(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof RefundBody>) { return this.payLinks.refund(u, id, b); }
  @Post("invoices/:id/send") @Perm("billing.invoice") @ZBody(SendDocBody) sendDoc(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof SendDocBody>) { return this.payLinks.sendDocument(u, id, b); }
  @Get("refunds") @Perm("billing.read") refunds(@CurrentUser() u: AuthUser, @Query() q: { from?: string; to?: string }) { return this.billing.refunds(u.orgId, q); }

  @Get("finance/aging") @Perm("billing.read") aging(@CurrentUser() u: AuthUser, @Query("asOf") asOf?: string) { return this.finance.aging(u, { asOf }); }
  @Get("finance/summary") @Perm("billing.read") summary(@CurrentUser() u: AuthUser, @Query() q: { from?: string; to?: string; labId?: string }) { return this.finance.summary(u, q); }
  @Get("expenses") @Perm("billing.read") expenses(@CurrentUser() u: AuthUser, @Query() q: { from?: string; to?: string; category?: string }) { return this.finance.expenses(u, q); }
  @Post("expenses") @Perm("expenses.manage") @ZBody(ExpenseBody) createExpense(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof ExpenseBody>) { return this.finance.createExpense(u, b); }
  @Post("expenses/:id/void") @Perm("expenses.manage") @ZBody(VoidExpense) voidExpense(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof VoidExpense>) { return this.finance.voidExpense(u, id, b.reason); }
  @Get("finance/aging.pdf") @Perm("billing.read") @Header("Content-Type", "application/pdf") async agingPdf(@CurrentUser() u: AuthUser, @Query("asOf") asOf?: string) {
    const a = await this.finance.aging(u, { asOf });
    return new StreamableFile(await renderTablePdf({ title: "Receivables aging", subtitle: `As of ${a.asOf.toISOString().slice(0, 10)}`, columns: [{ key: "party", label: "Party", width: 160 }, { key: "kind", label: "Type", width: 60 }, { key: "current", label: "Current", align: "right" }, { key: "d1_30", label: "1-30", align: "right" }, { key: "d31_60", label: "31-60", align: "right" }, { key: "d61_90", label: "61-90", align: "right" }, { key: "d90_plus", label: "90+", align: "right" }, { key: "total", label: "Total", align: "right" }], rows: a.parties, totals: { party: "Total", ...a.totals } }));
  }
  @Get("billing/reconciliation") @Perm("billing.read") reconcile(@CurrentUser() u: AuthUser) { return this.billing.reconcile(u.orgId); }
  @Get("cash-closes") @Perm("billing.read") closes(@CurrentUser() u: AuthUser) { return this.billing.listCashCloses(u.orgId); }
  @Post("cash-closes") @Perm("billing.cashclose") @ZBody(Close) close(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Close>) { return this.billing.cashClose(u, b); }

  @Get("dashboard") @Perm("dashboard.read") dashboard(@CurrentUser() u: AuthUser) { return this.insights.dashboard(u); }
  @Get("tat") @Perm("dashboard.read") tat(@CurrentUser() u: AuthUser, @Query() q: { from?: string; to?: string }) { return this.insights.tat(u.orgId, q); }
  @Post("tat/sla-sweep") @Perm("settings.manage") sweep() { return this.insights.slaSweep(); }
  @Get("statements/referring-doctors") @Perm("exports.run") statements(@CurrentUser() u: AuthUser, @Query() q: { from?: string; to?: string }) { return this.insights.referringDoctorStatements(u, q); }
  @Post("order-items/:id/send-out-cost") @Perm("billing.invoice") @ZBody(SendOut) sendOut(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof SendOut>) { return this.insights.recordSendOutCost(u, id, b); }
  @Get("send-out-costs") @Perm("billing.read") sendOutSummary(@CurrentUser() u: AuthUser, @Query() q: { from?: string; to?: string }) { return this.insights.sendOutSummary(u.orgId, q); }

  @Get("exports/:kind.csv") @Perm("exports.run") @Header("Content-Type", "text/csv; charset=utf-8")
  async csv(@CurrentUser() u: AuthUser, @Param("kind") kind: string, @Query() q: { from?: string; to?: string }, @Res({ passthrough: true }) res: Response) {
    if (!EXPORT_KINDS.includes(kind as ExportKind)) throw new BadRequestException({ code: "UNKNOWN_EXPORT", kinds: EXPORT_KINDS });
    res.setHeader("Content-Disposition", `attachment; filename="${kind}.csv"`);
    return this.exports.csv(u.orgId, kind as ExportKind, q);
  }
  @Get("exports/:kind.pdf") @Perm("exports.run") @Header("Content-Type", "application/pdf")
  async exportPdf(@Param("kind") kind: string, @Query() q: { from?: string; to?: string }, @Res({ passthrough: true }) res: Response, @CurrentUser() u: AuthUser) {
    if (!EXPORT_KINDS.includes(kind as ExportKind)) throw new BadRequestException({ code: "UNKNOWN_EXPORT", kinds: EXPORT_KINDS });
    res.setHeader("Content-Disposition", `attachment; filename="${kind}.pdf"`);
    return new StreamableFile(await this.exports.pdf(u.orgId, kind as ExportKind, q));
  }
  @Get("invoices/:id/pdf") @Perm("billing.read") @Header("Content-Type", "application/pdf") async invoicePdf(@CurrentUser() u: AuthUser, @Param("id") id: string) { return new StreamableFile(await this.exports.invoicePdf(u.orgId, id)); }
}
