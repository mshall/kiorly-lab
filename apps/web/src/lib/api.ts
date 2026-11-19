const KEY = "kiorly.lab.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: any,
  ) {
    super(`${status} ${code}`);
  }
}

export interface ApiOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

/** Fetch wrapper: bearer token, JSON, typed errors ({status, code}). 401 clears the session. */
export async function api<T = any>(path: string, opts: ApiOpts = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const tok = getToken();
  if (tok) headers.authorization = `Bearer ${tok}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(`/api/v1${path}`, { method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get("content-type") ?? "";
  const data: any = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && tok) {
      setToken(null);
      window.dispatchEvent(new Event("kiorly:logout"));
    }
    throw new ApiError(res.status, data?.code ?? data?.message ?? res.statusText, data);
  }
  return data as T;
}

/** Authenticated download (CSV/PDF) -> triggers a browser save. */
export async function download(path: string, filename: string): Promise<void> {
  const tok = getToken();
  const res = await fetch(`/api/v1${path}`, { headers: tok ? { authorization: `Bearer ${tok}` } : {} });
  if (!res.ok) throw new ApiError(res.status, "DOWNLOAD_FAILED", null);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const newKey = (): string => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
