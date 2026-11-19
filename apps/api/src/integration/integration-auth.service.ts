import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { verifyKiorlyRequest } from "@kiorex/contracts";
import type { IntegrationClient } from "@prisma/client";
import type { AuthedRequest } from "../auth/auth.types";
import { open } from "../common/secret-box";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Verifies Kiorex -> Kiorly Lab HMAC requests (KX-09 scheme: X-Kiorly-Client-Key / Timestamp(ms) / Nonce / Signature over
 * ts\nnonce\nMETHOD\npath\nsha256(body)). Uses the contract package's verifier. Nonces are remembered for the skew window
 * (in-process; a shared store is needed for multi-instance production: NEEDS_HUMAN go-live item).
 */
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
    if (!client || !client.active) throw new UnauthorizedException({ code: "INVALID_CLIENT" });
    const v = verifyKiorlyRequest({ headers: req.headers, method: req.method, path: req.originalUrl, body: req.rawBody ?? "", secret: open(client.secretEnc) });
    if (!v.ok) throw new UnauthorizedException({ code: "INVALID_SIGNATURE", reason: v.reason });
    const nonce = hdr("x-kiorly-nonce")!;
    const now = Date.now();
    for (const [n, t] of this.nonces) if (now - t > 6 * 60_000) this.nonces.delete(n);
    const nk = `${client.id}:${nonce}`;
    if (this.nonces.has(nk)) throw new UnauthorizedException({ code: "REPLAYED_NONCE" });
    this.nonces.set(nk, now);
    return client;
  }
}
