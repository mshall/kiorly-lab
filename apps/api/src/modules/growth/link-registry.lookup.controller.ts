import { Controller, Get, Inject, NotFoundException, Param, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../auth/decorators";
import type { AuthedRequest } from "../../auth/auth.types";
import { IntegrationAuthService } from "../../integration/integration-auth.service";
import { ProviderLinksService } from "./provider-links.service";

/**
 * Signed lookup and reconciliation feed for the Kiorex link registry (copy of the Clinic 1.11.0 contract, `product` LAB added; machine API, request HMAC through
 * the existing IntegrationAuthService). The client key binds exactly ONE organisation, so a Kiorex client can only ever read the links of the organisation it
 * is registered for; only the KIOREX_BOOKING client reads the registry.
 */
@ApiTags("kiorex-links")
@Controller("integration/v1/referral-links")
export class LinkRegistryLookupController {
  constructor(@Inject(IntegrationAuthService) private readonly auth: IntegrationAuthService, @Inject(ProviderLinksService) private readonly links: ProviderLinksService) {}

  private async org(req: AuthedRequest): Promise<string> {
    const client = await this.auth.authenticate(req);
    if (client.source !== "KIOREX_BOOKING") throw new NotFoundException({ code: "NOT_AVAILABLE_FOR_CLIENT" });
    return client.orgId;
  }

  @Public() @Get(":code") @ApiOperation({ summary: "Signed lookup of one referral link (link registry): code, organisation, product, status" })
  async one(@Req() req: AuthedRequest, @Param("code") code: string) {
    const rec = await this.links.lookupRecord(await this.org(req), code);
    if (!rec) throw new NotFoundException({ code: "REFERRAL_LINK_NOT_FOUND", message: "No link with this code exists" });
    return rec;
  }

  @Public() @Get() @ApiOperation({ summary: "Reconciliation feed: links created or changed since a timestamp, oldest first, cursor paged" })
  async feed(@Req() req: AuthedRequest, @Query("updatedSince") updatedSince?: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    const since = updatedSince ? new Date(updatedSince) : undefined;
    return this.links.listRecords(await this.org(req), { updatedSince: since && !Number.isNaN(since.getTime()) ? since : undefined, limit: limit ? Number(limit) : undefined, cursor });
  }
}
