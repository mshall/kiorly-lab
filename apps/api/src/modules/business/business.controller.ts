import { Body, Controller, Get, Header, Headers, Inject, Param, Post, Put, Query, Res, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { RequiresFlag } from "../../feature-flags/requires-flag.guard";
import { BillingService } from "./billing.service";
import { EXPORT_KINDS, ExportsService, type ExportKind } from "./exports.service";
import { InsightsService } from "./insights.service";
import { BadRequestException } from "@nestjs/common";

const num = z.coerce.number();
const PriceList = z.object({ name: z.string().min(1), isDefault: z.boolean().optional() }).strict();
const Price = z.object({ testId: z.string().optional(), packageId: z.string().optional(), amount: num.nonnegative() }).strict();
const Account = z.object({ name: z.string().min(1), priceListId: z.string().optional(), paymentTermsDays: z.number().int().min(0).max(365).optional(), creditLimit: num.nonnegative().optional() }).strict();
const Pay = z.object({ method: z.enum(["CASH", "CARD"]), amount: num.positive(), cardToken: z.string().optional() }).strict();
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
  ) {}

  @Get("price-lists") @Perm("billing.read") priceLists(@CurrentUser() u: AuthUser) { return this.billing.listPriceLists(u.orgId); }
  @Post("price-lists") @Perm("billing.pricing") @RequiresFlag("lab.module") @ZBody(PriceList) createPl(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof PriceList>) { return this.billing.createPriceList(u, b); }
  @Get("price-lists/:id/items") @Perm("billing.read") plItems(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.billing.priceListItems(u.orgId, id); }
  @Put("price-lists/:id/prices") @Perm("billing.pricing") @RequiresFlag("lab.module") @ZBody(Price) setPrice(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Price>) { return this.billing.setPrice(u, id, b); }
  @Get("b2b-accounts") @Perm("billing.read") accounts(@CurrentUser() u: AuthUser) { return this.billing.listAccounts(u.orgId); }
  @Post("b2b-accounts") @Perm("billing.pricing") @RequiresFlag("lab.module") @ZBody(Account) createAccount(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Account>) { return this.billing.createAccount(u, b); }

  @Get("invoices") @Perm("billing.read") invoices(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.billing.listInvoices(u, q); }
  @Get("invoices/:id") @Perm("billing.read") invoice(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.billing.getInvoice(u.orgId, id); }
  @Post("orders/:orderId/invoice") @Perm("billing.invoice") @RequiresFlag("lab.module") invoiceOrder(@CurrentUser() u: AuthUser, @Param("orderId") orderId: string) { return this.billing.invoiceOrder(u, orderId); }
  @Post("invoices/:id/void") @Perm("billing.invoice") @ZBody(Void) voidInvoice(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Void>) { return this.billing.voidInvoice(u, id, b.reason); }
  @Post("invoices/:id/payments") @Perm("billing.payment") @ZBody(Pay) pay(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Pay>, @Headers("idempotency-key") key?: string) { return this.billing.pay(u, id, b, key); }
  @Post("payments/:id/refund") @Perm("billing.payment") refund(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.billing.refund(u, id); }
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
  @Get("invoices/:id/pdf") @Perm("billing.read") @Header("Content-Type", "application/pdf") async invoicePdf(@CurrentUser() u: AuthUser, @Param("id") id: string) { return new StreamableFile(await this.exports.invoicePdf(u.orgId, id)); }
}
