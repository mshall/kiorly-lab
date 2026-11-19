import { Injectable } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { appConfig } from "../config/app-config";

/** Object storage port. STORAGE_MODE=mock stores under STORAGE_DIR on local disk; real = S3 adapter (go-live pass, no @aws-sdk outside adapters). */
@Injectable()
export class StorageAdapter {
  private path(key: string) {
    const root = resolve(appConfig.storageDir());
    const p = resolve(join(root, key));
    if (!p.startsWith(root)) throw new Error("invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    if (appConfig.storageMode() === "real") throw new Error("STORAGE_MODE=real is not wired yet (Docs/NEEDS_HUMAN.md, Provider go-live)");
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
}
