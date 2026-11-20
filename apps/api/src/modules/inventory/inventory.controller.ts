import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { InventoryService } from "./inventory.service";

const num = z.coerce.number();
const Supplier = z.object({ name: z.string().min(2).max(120), contactName: z.string().max(80).optional(), phone: z.string().max(24).optional(), email: z.string().email().optional(), address: z.string().max(300).optional(), leadTimeDays: z.number().int().min(0).max(365).optional(), paymentTermsDays: z.number().int().min(0).max(365).optional() }).strict();
const SupplierPatch = Supplier.partial().extend({ active: z.boolean().optional() }).strict();
const Item = z.object({ code: z.string().min(2).max(30), name: z.string().min(2).max(120), nameAr: z.string().max(120).optional(), category: z.enum(["REAGENT", "CONSUMABLE", "CALIBRATOR", "CONTROL", "GENERAL"]).optional(), unit: z.string().min(1).max(20).optional(), reorderLevel: num.nonnegative().optional(), reorderQty: num.nonnegative().optional(), supplierId: z.string().optional(), storageTemp: z.string().max(40).optional() }).strict();
const ItemPatch = Item.omit({ code: true }).partial().extend({ supplierId: z.string().nullable().optional(), active: z.boolean().optional() }).strict();
const LotStatus = z.object({ status: z.enum(["ACTIVE", "QUARANTINE"]) }).strict();
const Adjust = z.object({ lotId: z.string(), qty: num, reason: z.string().min(3).max(200) }).strict();
const Rules = z.object({ rules: z.array(z.object({ itemId: z.string(), qtyPerTest: num.positive(), wastagePercent: num.min(0).max(100).optional() }).strict()).max(30) }).strict();
const Po = z.object({ labId: z.string().optional(), supplierId: z.string(), expectedAt: z.string().optional(), notes: z.string().max(500).optional(), lines: z.array(z.object({ itemId: z.string(), qty: num.positive(), unitCost: num.nonnegative() }).strict()).min(1).max(100) }).strict();
const Receipt = z.object({ labId: z.string().optional(), poId: z.string().optional(), supplierId: z.string().optional(), invoiceRef: z.string().max(60).optional(), note: z.string().max(300).optional(), lines: z.array(z.object({ itemId: z.string(), lotNumber: z.string().min(1).max(40), expiryDate: z.string().optional(), qty: num.positive(), unitCost: num.nonnegative(), location: z.string().max(60).optional() }).strict()).min(1).max(100) }).strict();
const Count = z.object({ labId: z.string().optional(), note: z.string().max(200).optional() }).strict();
const Counted = z.object({ lines: z.array(z.object({ lotId: z.string(), countedQty: num.nonnegative() }).strict()).min(1).max(500) }).strict();
const Lab = z.object({ labId: z.string().optional() }).strict();

/** M6 (KLINV): reagent & consumable inventory. Not flag-gated. */
@ApiTags("inventory")
@ApiBearerAuth()
@Controller("inventory")
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly svc: InventoryService) {}

  @Get("summary") @Perm("inventory.read") summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u); }
  @Get("stock") @Perm("inventory.read") stock(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.svc.stock(u, q); }
  @Get("suppliers") @Perm("inventory.read") suppliers(@CurrentUser() u: AuthUser) { return this.svc.suppliers(u.orgId); }
  @Post("suppliers") @Perm("inventory.manage") @ZBody(Supplier) createSupplier(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Supplier>) { return this.svc.createSupplier(u, b); }
  @Put("suppliers/:id") @Perm("inventory.manage") @ZBody(SupplierPatch) updateSupplier(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof SupplierPatch>) { return this.svc.updateSupplier(u, id, b); }
  @Post("items") @Perm("inventory.manage") @ZBody(Item) createItem(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Item>) { return this.svc.createItem(u, b); }
  @Put("items/:id") @Perm("inventory.manage") @ZBody(ItemPatch) updateItem(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof ItemPatch>) { return this.svc.updateItem(u, id, b); }
  @Get("items/:id/lots") @Perm("inventory.read") lots(@CurrentUser() u: AuthUser, @Param("id") id: string, @Query("labId") labId?: string) { return this.svc.lots(u, id, labId); }
  @Put("lots/:id/status") @Perm("inventory.manage") @ZBody(LotStatus) lotStatus(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof LotStatus>) { return this.svc.setLotStatus(u, id, b.status); }
  @Post("adjustments") @Perm("inventory.manage") @ZBody(Adjust) adjust(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Adjust>) { return this.svc.adjust(u, b); }
  @Post("dispose-expired") @Perm("inventory.manage") @ZBody(Lab) disposeExpired(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Lab>) { return this.svc.disposeExpired(u, b.labId); }
  @Get("movements") @Perm("inventory.read") movements(@CurrentUser() u: AuthUser, @Query() q: { itemId?: string; type?: string; limit?: string }) { return this.svc.movements(u, q); }

  @Get("consumption-rules") @Perm("inventory.read") rules(@CurrentUser() u: AuthUser, @Query("testId") testId?: string) { return this.svc.rules(u, testId); }
  @Put("consumption-rules/:testId") @Perm("inventory.manage") @ZBody(Rules) setRules(@CurrentUser() u: AuthUser, @Param("testId") testId: string, @Body() b: z.infer<typeof Rules>) { return this.svc.setRules(u, testId, b.rules); }
  @Get("cost-per-test") @Perm("inventory.read") cost(@CurrentUser() u: AuthUser, @Query() q: { from?: string; to?: string }) { return this.svc.costPerTest(u, q); }

  @Get("reorder-suggestions") @Perm("inventory.read") suggestions(@CurrentUser() u: AuthUser, @Query("labId") labId?: string) { return this.svc.reorderSuggestions(u, labId); }
  @Get("purchase-orders") @Perm("inventory.read") pos(@CurrentUser() u: AuthUser, @Query() q: { status?: string }) { return this.svc.pos(u, q); }
  @Post("purchase-orders") @Perm("inventory.manage") @ZBody(Po) createPo(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Po>) { return this.svc.createPo(u, b); }
  @Get("purchase-orders/:id") @Perm("inventory.read") po(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.getPo(u, id); }
  @Post("purchase-orders/:id/send") @Perm("inventory.manage") send(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.setPoStatus(u, id, "SENT"); }
  @Post("purchase-orders/:id/cancel") @Perm("inventory.manage") cancelPo(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.setPoStatus(u, id, "CANCELLED"); }
  @Get("receipts") @Perm("inventory.read") receipts(@CurrentUser() u: AuthUser) { return this.svc.receipts(u); }
  @Post("receipts") @Perm("inventory.manage") @ZBody(Receipt) receive(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Receipt>) { return this.svc.receive(u, b); }

  @Get("counts") @Perm("inventory.read") counts(@CurrentUser() u: AuthUser) { return this.svc.counts(u); }
  @Post("counts") @Perm("inventory.manage") @ZBody(Count) startCount(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Count>) { return this.svc.startCount(u, b); }
  @Get("counts/:id") @Perm("inventory.read") count(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.getCount(u, id); }
  @Put("counts/:id/lines") @Perm("inventory.manage") @ZBody(Counted) setCounted(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Counted>) { return this.svc.setCounted(u, id, b.lines); }
  @Post("counts/:id/complete") @Perm("inventory.manage") completeCount(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.completeCount(u, id); }
}
