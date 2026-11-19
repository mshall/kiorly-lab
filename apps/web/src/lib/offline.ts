/**
 * Offline write queue for the phlebotomist PWA (IndexedDB). Every queued call carries an Idempotency-Key, so replays after a
 * flaky connection can never double-apply on the server. Non-retryable 4xx responses are kept as "failed" for the user to see.
 */
export interface QueuedCall {
  id: string;
  method: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
  createdAt: number;
  status: "pending" | "failed";
  error?: string;
}

const DB = "kiorly-lab-offline";
const STORE = "queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export const enqueue = (c: Omit<QueuedCall, "status" | "createdAt">) => tx("readwrite", (s) => s.put({ ...c, status: "pending", createdAt: Date.now() } satisfies QueuedCall));
export const listQueue = (): Promise<QueuedCall[]> => tx("readonly", (s) => s.getAll() as IDBRequest<QueuedCall[]>).then((r) => r.sort((a, b) => a.createdAt - b.createdAt));
export const removeCall = (id: string) => tx("readwrite", (s) => s.delete(id));
export const clearFailed = async () => {
  for (const c of await listQueue()) if (c.status === "failed") await removeCall(c.id);
};

/** Sends pending calls in order; stops at the first network failure (retry later), marks 4xx as failed. */
export async function flushQueue(send: (c: QueuedCall) => Promise<{ ok: boolean; status: number; error?: string }>): Promise<{ sent: number; failed: number; remaining: number }> {
  let sent = 0;
  let failed = 0;
  for (const c of await listQueue()) {
    if (c.status === "failed") continue;
    let r: { ok: boolean; status: number; error?: string };
    try {
      r = await send(c);
    } catch {
      break; // offline: keep the rest
    }
    if (r.ok) {
      await removeCall(c.id);
      sent++;
    } else if (r.status >= 500 || r.status === 429 || r.status === 0) {
      break;
    } else {
      await tx("readwrite", (s) => s.put({ ...c, status: "failed", error: r.error ?? `HTTP ${r.status}` }));
      failed++;
    }
  }
  return { sent, failed, remaining: (await listQueue()).filter((c) => c.status === "pending").length };
}
