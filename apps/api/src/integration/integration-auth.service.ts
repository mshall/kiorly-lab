import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { verifyKiorlyRequest } from "@kiorex/contracts";
import type { IntegrationClient } from "../generated/prisma/client";
import type { AuthedRequest } from "../auth/auth.types";
import { open } from "../common/secret-box";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Verifies Kiorex -> Kiorly Lab HMAC requests (KX-09 scheme: X-Kiorly-Client-Key / Timestamp(ms) / Nonce / Signature over
 * ts\nnonce\nMETHOD\npath\nsha256(body)). Uses the contract package's verifier. Nonces are remembered for the skew window
 * (in-process; a shared store is needed for multi-instance production: NEEDS_HUMAN go-live item).
 */
/**
 * One rejection shape for every failed machine-auth check, identical to the Pharmacy's MarketplaceHmacGuard (so both partner APIs answer a rejected
 * Kiorex request the same way): 401 `{ statusCode, code: "HMAC_REJECTED", message: <reason> }`. The reason is the contract verifier's own word
 * (missing_headers, stale_timestamp, bad_signature) or "unknown client key" / "nonce replay"; never a secret or the canonical string.
 */
export const hmacRejected = (reason: string): UnauthorizedException => new UnauthorizedException({ statusCode: 401, code: "HMAC_REJECTED", message: reason });
const deny = hmacRejected;

@Injectable()
export class IntegrationAuthService {
  private readonly nonces = new Map<string, number>();
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async authenticate(req: AuthedRequest): Promise<IntegrationClient> {
    const hdr = (n: string) => {
      const v = req.headers[n.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };
    const key = hdr("x-kiorly-client-key");
    const client = key ? await this.prisma.integrationClient.findUnique({ where: { key } }) : null;
    if (!client || !client.active) throw deny("unknown client key");
    // standalone labs accept no external orders and expose no results to partner systems
    const tenant = await this.prisma.tenant.findUnique({ where: { id: client.orgId }, select: { integrationMode: true } });
    if (tenant?.integrationMode === "STANDALONE") throw new ForbiddenException({ code: "INTEGRATION_DISABLED", message: "this lab runs in standalone mode" });
    const v = verifyKiorlyRequest({ headers: req.headers, method: req.method, path: req.originalUrl, body: req.rawBody ?? "", secret: open(client.secretEnc) });
    if (!v.ok) throw deny(v.reason);
    const nonce = hdr("x-kiorly-nonce")!;
    const now = Date.now();
    for (const [n, t] of this.nonces) if (now - t > 6 * 60_000) this.nonces.delete(n);
    const nk = `${client.id}:${nonce}`;
    if (this.nonces.has(nk)) throw deny("nonce replay");
    this.nonces.set(nk, now);
    return client;
  }
}
