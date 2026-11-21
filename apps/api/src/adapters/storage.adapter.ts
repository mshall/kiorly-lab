import { Injectable } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { appConfig } from "../config/app-config";
import { providerConfig } from "../providers/provider-env";
import { ProviderError, providerRequest, type FetchLike } from "../providers/http";

/**
 * Object storage port. STORAGE_MODE=mock stores under STORAGE_DIR on local disk. STORAGE_MODE=real talks to an HTTP object store
 * (STORAGE_API_URL = bucket/gateway base, STORAGE_API_KEY bearer): PUT {url}/{key} and GET {url}/{key}. Use an S3-compatible gateway or a
 * presigning proxy; no @aws-sdk outside adapters.
 */
@Injectable()
export class StorageAdapter {
  /** Test seam for the real HTTP store. */
  static fetchImpl?: FetchLike;
  private path(key: string) {
    const root = resolve(appConfig.storageDir());
    const p = resolve(join(root, key));
    if (!p.startsWith(root)) throw new Error("invalid storage key");
    return p;
  }
  private remote(key: string) {
    if (key.includes("..")) throw new Error("invalid storage key");
    return `/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  private auth(): Record<string, string> { const c = providerConfig("STORAGE"); return c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}; }
  async put(key: string, data: Buffer): Promise<void> {
    if (appConfig.storageMode() === "real") {
      await providerRequest(providerConfig("STORAGE"), { method: "PUT", path: this.remote(key), rawBody: data, headers: { "content-type": "application/octet-stream" }, idempotencyKey: key }, this.auth(), StorageAdapter.fetchImpl);
      return;
    }
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string): Promise<Buffer> {
    if (appConfig.storageMode() === "real") {
      const r = await providerRequest(providerConfig("STORAGE"), { method: "GET", path: this.remote(key), binary: true }, this.auth(), StorageAdapter.fetchImpl);
      if (!r.raw) throw new ProviderError("BAD_RESPONSE", "empty object");
      return Buffer.from(r.raw);
    }
    return readFile(this.path(key));
  }
}
