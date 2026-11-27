import { providerMode } from "../providers/provider-env";
/** Central, lazily-read configuration. Every third-party provider has MODE=mock|real (default mock). */
export const DEFAULT_PUBLIC_BASE_URL = "http://localhost:5193";
export type Mode = "mock" | "real";
const mode = (v: string | undefined): Mode => (v === "real" ? "real" : "mock");

export const appConfig = {
  isProd: () => process.env.NODE_ENV === "production",
  isTest: () => process.env.NODE_ENV === "test",
  /** `dev` (local, non-production), `oidc` (Passport only), `both` (explicit: e-mail + password AND Passport side by side, allowed in production). */
  authMode: (): "dev" | "oidc" | "both" => (process.env.AUTH_MODE === "oidc" ? "oidc" : process.env.AUTH_MODE === "both" ? "both" : "dev"),
  /** E-mail + password sign-in offered (`dev` and `both`). */
  localLogin: () => process.env.AUTH_MODE !== "oidc",
  /** Wrong-password lockout: threshold (3..20, default 5) and minutes (1..240, default 15). A hard range, not a switch. */
  loginLockThreshold: () => Math.min(20, Math.max(3, Math.floor(Number(process.env.LAB_LOGIN_LOCK_THRESHOLD) || 5))),
  loginLockMinutes: () => Math.min(240, Math.max(1, Math.floor(Number(process.env.LAB_LOGIN_LOCK_MINUTES) || 15))),
  /**
   * HS256 secret for dev tokens and the Passport web session. Outside production a dev default exists; in production it is REQUIRED
   * (`JWT_SECRET` as injected by the infra secret, or `AUTH_JWT_SECRET`) so sessions are never signed with a well-known key.
   */
  jwtDevSecret: () => {
    const s = process.env.JWT_DEV_SECRET || process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET;
    if (s) return s;
    if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET (or AUTH_JWT_SECRET) is required in production");
    return "dev-only-secret-change-me-dev-only-secret";
  },
  oidcIssuer: () => process.env.KIOREX_OIDC_ISSUER?.replace(/\/+$/, ""),
  oidcAudience: () => process.env.KIOREX_OIDC_AUDIENCE ?? "kiorly-lab",
  mfaEnforced: () => process.env.FORCE_PRIVILEGED_MFA === "true" || process.env.NODE_ENV === "production",
  /** IANA zone defining "today" for lab-facing day boundaries (mobile summary). The lab has no per-lab timezone column yet; Egypt market default. */
  labTimezone: () => process.env.LAB_TIMEZONE?.trim() || "Africa/Cairo",
  /** Base of every patient-facing link the Lab emits (secure report link `/r/:token`, `/verify/:id`, mock pay). Dev default = the Lab web dev server (:5193). Set PUBLIC_BASE_URL per environment. */
  publicBaseUrl: () => (process.env.PUBLIC_BASE_URL?.trim() || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, ""),
  storageDir: () => process.env.STORAGE_DIR ?? "./.data/storage",
  /** Legacy aggregate: "real" when ANY of SMS/EMAIL/WHATSAPP is real (per-channel switches: SMS_MODE, EMAIL_MODE, WHATSAPP_MODE). */
  messagingMode: (): Mode => (["SMS", "EMAIL", "WHATSAPP"] as const).some((k) => providerMode(k) === "real") ? "real" : "mock",
  pspMode: (): Mode => providerMode("PAYMENT"),
  storageMode: (): Mode => providerMode("STORAGE"),
  analyzerMode: () => mode(process.env.ANALYZER_MODE),
  kiorexMode: () => mode(process.env.KIOREX_MODE),
  kiorexWebhookUrl: () => process.env.KIOREX_WEBHOOK_URL ?? "http://localhost:4000/api/v1/webhooks/lab",
  kiorexWebhookSecret: () => process.env.KIOREX_WEBHOOK_SECRET ?? "kx_dev_lab_webhook_secret",
  flagsWebhookSecret: () => process.env.KIOREX_FLAGS_WEBHOOK_SECRET ?? process.env.KIOREX_PRODUCT_SECRET ?? "ff_dev_secret_change_me",
  /** Platform key-encryption-key for integration client secrets (dev default only). */
  kek: () => process.env.INTEGRATION_KEK ?? "dev-kek-change-me-dev-kek-change-me!",
  timersEnabled: () => process.env.TIMERS_ENABLED !== "false" && process.env.NODE_ENV !== "test",
  reportLinkTtlDays: () => Number(process.env.REPORT_LINK_TTL_DAYS ?? 30),
};
