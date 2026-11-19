import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { appConfig } from "../config/app-config";

const key = () => createHash("sha256").update(appConfig.kek()).digest();

/** AES-256-GCM envelope for integration client secrets at rest. The KEK comes from the secrets adapter in production (go-live). */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function open(sealed: string): string {
  const [iv, tag, enc] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
