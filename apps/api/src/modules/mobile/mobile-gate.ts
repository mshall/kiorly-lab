import type { AuthedRequest } from "../../auth/auth.types";

export const mobilePath = (req: Pick<AuthedRequest, "originalUrl">) => req.originalUrl.split("?")[0].replace(/^\/api\/v1/, "").replace(/\/+$/, "");

/**
 * Routes that stay open on EVERY plan (ADR-025 safety-alert inbox + discovery + remote sign-out + auth):
 * /auth/*, GET /mobile/bootstrap, /mobile/alerts*, POST /mobile/upgrade-request (a Basic org must be able to ask), DELETE /mobile/devices/:id.
 */
export function isMobileExempt(method: string, p: string): boolean {
  if (p.startsWith("/auth/") || p === "/auth") return true;
  if (method === "POST" && p === "/mobile/upgrade-request") return true;
  if (p === "/mobile/bootstrap" || p === "/mobile/alerts" || p.startsWith("/mobile/alerts/")) return true;
  return method === "DELETE" && /^\/mobile\/devices\/[^/]+$/.test(p);
}


/** Routes that need the `mobile_staff_app` plan entitlement: every /mobile/* route and every request identifying as the app, minus the exempt ones. */
export function isMobilePlanGated(req: Pick<AuthedRequest, "originalUrl" | "method" | "headers">): boolean {
  const p = mobilePath(req);
  const c = req.headers["x-kiorly-client"];
  const client = Array.isArray(c) ? c[0] : c;
  const isApp = Boolean(client && /^(?:kiorly|kiorly-team|kiorly-work)(\/|$)/.test(client));
  return (isApp || p.startsWith("/mobile/")) && !isMobileExempt(req.method, p);
}
