import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { RequiresFlag } from "../../feature-flags/requires-flag.guard";
import { ZBody, z } from "../../common/zod";
import { CatalogueService } from "./catalogue.service";

const num = z.coerce.number();
const Section = z.enum(["GENERAL", "HEMATOLOGY", "CHEMISTRY", "IMMUNOLOGY", "SEROLOGY", "COAGULATION", "URINALYSIS", "MICROBIOLOGY", "HISTOPATHOLOGY", "CYTOLOGY", "MOLECULAR"]);
const AnalyteBody = z.object({
  code: z.string().min(1).max(32), nameEn: z.string().min(1), nameAr: z.string().optional(), unit: z.string().optional(), precision: z.number().int().min(0).max(6).optional(), analyzerCodes: z.array(z.string()).optional(),
  valueType: z.enum(["NUMERIC", "TEXT", "SEMI_QUANT", "CHOICE"]).optional(), allowedValues: z.array(z.string().min(1).max(60)).max(30).optional(), normalValues: z.array(z.string().min(1).max(60)).max(30).optional(), formula: z.string().min(3).max(300).optional(),
}).strict();
const AnalytePatch = AnalyteBody.omit({ code: true }).partial().extend({ formula: z.string().min(3).max(300).nullable().optional(), active: z.boolean().optional() }).strict();
const TestBody = z.object({
  code: z.string().min(1).max(32), nameEn: z.string().min(1), nameAr: z.string().optional(), specimenType: z.string().min(1), container: z.string().optional(),
  volumeMl: num.positive().optional(), fastingRequired: z.boolean().optional(), prepInstructionsEn: z.string().optional(), prepInstructionsAr: z.string().optional(),
  tatMinutes: z.number().int().positive().optional(), price: num.nonnegative(), sendOut: z.boolean().optional(), analyteCodes: z.array(z.string()).optional(), section: Section.optional(),
}).strict();
const TestPatch = TestBody.omit({ code: true }).partial().extend({ active: z.boolean().optional() }).strict();
const PackageBody = z.object({ code: z.string().min(1), nameEn: z.string().min(1), nameAr: z.string().optional(), price: num.nonnegative(), testCodes: z.array(z.string()).min(1) }).strict();
const IntervalBody = z.object({ sex: z.enum(["M", "F", "OTHER", "UNKNOWN"]).nullable().optional(), ageMinDays: z.number().int().min(0).optional(), ageMaxDays: z.number().int().min(0).nullable().optional(), low: num.nullable().optional(), high: num.nullable().optional(), source: z.string().optional(), condition: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/).nullable().optional() }).strict();

@ApiTags("catalogue")
@ApiBearerAuth()
@Controller("catalogue")
export class CatalogueController {
  constructor(@Inject(CatalogueService) private readonly svc: CatalogueService) {}

  @Get("analytes") @Perm("catalogue.read") analytes(@CurrentUser() u: AuthUser) { return this.svc.listAnalytes(u.orgId); }
  @Post("analytes") @Perm("catalogue.write") @RequiresFlag("lab.module") @ZBody(AnalyteBody) createAnalyte(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof AnalyteBody>) { return this.svc.createAnalyte(u, b); }

  @Put("analytes/:id") @Perm("catalogue.write") @RequiresFlag("lab.module") @ZBody(AnalytePatch) updateAnalyte(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof AnalytePatch>) { return this.svc.updateAnalyte(u, id, b); }

  @Get("tests") @Perm("catalogue.read") @ApiOperation({ summary: "KLORD01 test catalogue" }) tests(@CurrentUser() u: AuthUser, @Query() q: { active?: string; search?: string }) { return this.svc.listTests(u.orgId, q); }
  @Get("tests/:id") @Perm("catalogue.read") test(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.getTest(u.orgId, id); }
  @Post("tests") @Perm("catalogue.write") @RequiresFlag("lab.module") @ZBody(TestBody) createTest(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof TestBody>) { return this.svc.createTest(u, b); }
  @Put("tests/:id") @Perm("catalogue.write") @RequiresFlag("lab.module") @ZBody(TestPatch) updateTest(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof TestPatch>) { return this.svc.updateTest(u, id, b); }
  @Get("tests/:id/price-history") @Perm("billing.read") priceHistory(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.priceHistory(u.orgId, id); }

  @Get("packages") @Perm("catalogue.read") packages(@CurrentUser() u: AuthUser) { return this.svc.listPackages(u.orgId); }
  @Post("packages") @Perm("catalogue.write") @RequiresFlag("lab.module") @ZBody(PackageBody) createPackage(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof PackageBody>) { return this.svc.createPackage(u, b); }

  @Get("analytes/:id/reference-intervals") @Perm("catalogue.read") intervals(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.listIntervals(u.orgId, id); }
  @Post("analytes/:id/reference-intervals") @Perm("catalogue.write") @ZBody(IntervalBody) addInterval(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof IntervalBody>) { return this.svc.addInterval(u, id, b); }
}
