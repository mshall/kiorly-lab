import { signKiorlyRequest } from "@kiorex/contracts";
import { type Res, type TestApp, call } from "./app";

export interface Client {
  key: string;
  secret: string;
}

/** Signs and sends a Kiorex -> Kiorly Lab request with the contract package's signer (KX-09 scheme). */
export async function post(t: TestApp, c: Client, path: string, body: unknown, opts: { method?: string; tamper?: boolean; timestamp?: number; nonce?: string; secret?: string } = {}): Promise<Res> {
  const method = opts.method ?? "POST";
  const raw = body === undefined ? "" : JSON.stringify(body);
  const signed = signKiorlyRequest({ clientKey: c.key, clientSecret: opts.secret ?? c.secret, method, path: `/api/v1${path}`, body: raw, timestamp: opts.timestamp, nonce: opts.nonce });
  const headers = { ...signed.headers };
  delete headers["X-Kiorly-Client-Secret"];
  return call(t, method, path, { headers, rawBody: opts.tamper ? raw + " " : raw === "" ? undefined : raw });
}
