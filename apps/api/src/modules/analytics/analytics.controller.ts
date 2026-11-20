import { Controller, Get, Header, Inject, Param, Query, Res, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ReportsService } from "./reports.service";

/** M9 (KLBIZ04): statistics and the report library (20+ reports with CSV and PDF). */
@ApiTags("analytics")
@ApiBearerAuth()
@Controller("analytics")
export class AnalyticsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get("reports") @Perm("analytics.read") list(@CurrentUser() u: AuthUser) { return this.reports.list(u); }
  @Get("reports/:kind.csv") @Perm("analytics.read") @Header("Content-Type", "text/csv; charset=utf-8")
  async csv(@CurrentUser() u: AuthUser, @Param("kind") kind: string, @Query() q: { from?: string; to?: string; labId?: string }, @Res({ passthrough: true }) res: Response) { res.setHeader("Content-Disposition", `attachment; filename="${kind}.csv"`); return this.reports.csv(u, kind, q); }
  @Get("reports/:kind.pdf") @Perm("analytics.read") @Header("Content-Type", "application/pdf")
  async pdf(@CurrentUser() u: AuthUser, @Param("kind") kind: string, @Query() q: { from?: string; to?: string; labId?: string }, @Res({ passthrough: true }) res: Response) { res.setHeader("Content-Disposition", `attachment; filename="${kind}.pdf"`); return new StreamableFile(await this.reports.pdf(u, kind, q)); }
  @Get("reports/:kind") @Perm("analytics.read") run(@CurrentUser() u: AuthUser, @Param("kind") kind: string, @Query() q: { from?: string; to?: string; labId?: string }) { return this.reports.run(u, kind, q); }
}
