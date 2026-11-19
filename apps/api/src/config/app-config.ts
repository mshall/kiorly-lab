/** Central, lazily-read configuration. Every third-party provider has MODE=mock|real (default mock). */
export type Mode = "mock" | "real";
const mode = (v: string | undefined): Mode => (v === "real" ? "real" : "mock");

export const appConfig = {
  isProd: () => process.env.NODE_ENV === "production",
  isTest: () => process.env.NODE_ENV === "test",
  authMode: (): "dev" | "oidc" => (process.env.AUTH_MODE === "oidc" ? "oidc" : "dev"),
  /** Dev-only HS256 secret. In production AUTH_MODE must be oidc. */
  jwtDevSecret: () => process.env.JWT_DEV_SECRET ?? "dev-only-secret-change-me-dev-only-secret",
  oidcIssuer: () => process.env.KIOREX_OIDC_ISSUER?.replace(/\/+$/, ""),
  oidcAudience: () => process.env.KIOREX_OIDC_AUDIENCE ?? "kiorly-lab",
  mfaEnforced: () => process.env.FORCE_PRIVILEGED_MFA === "true" || process.env.NODE_ENV === "production",
  publicBaseUrl: () => (process.env.PUBLIC_BASE_URL ?? "http://localhost:5191").replace(/\/+$/, ""),
  storageDir: () => process.env.STORAGE_DIR ?? "./.data/storage",
  messagingMode: () => mode(process.env.MESSAGING_MODE),
  pspMode: () => mode(process.env.PSP_MODE),
  storageMode: () => mode(process.env.STORAGE_MODE),
  analyzerMode: () => mode(process.env.ANALYZER_MODE),
  kiorexMode: () => mode(process.env.KIOREX_MODE),
  kiorexWebhookUrl: () => process.env.KIOREX_WEBHOOK_URL ?? "http://localhost:4000/api/v1/webhooks/kiorly",
  kiorexWebhookSecret: () => process.env.KIOREX_WEBHOOK_SECRET ?? "kx_dev_webhook_secret",
  flagsWebhookSecret: () => process.env.KIOREX_FLAGS_WEBHOOK_SECRET ?? process.env.KIOREX_PRODUCT_SECRET ?? "ff_dev_secret_change_me",
  /** Platform key-encryption-key for integration client secrets (dev default only). */
  kek: () => process.env.INTEGRATION_KEK ?? "dev-kek-change-me-dev-kek-change-me!",
  timersEnabled: () => process.env.TIMERS_ENABLED !== "false" && process.env.NODE_ENV !== "test",
  reportLinkTtlDays: () => Number(process.env.REPORT_LINK_TTL_DAYS ?? 30),
};
