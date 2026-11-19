# Kiorly Lab API notes

Machine-readable spec: [`openapi.json`](./openapi.json) (regenerate with `npm run openapi -w api`); live Swagger at `/docs`. Base path `/api/v1`.

## Auth
- Staff: `Authorization: Bearer <JWT>`. Production (`AUTH_MODE=oidc`): Kiorex Account RS256 access token, `iss`/`aud` validated against JWKS; roles and tenant always come from the lab database (`StaffUser`), never from the token or headers. Privileged roles (owner, lab director, authorised signatory) need an MFA `amr` claim in production.
- Dev (`AUTH_MODE=dev`, disabled when `NODE_ENV=production`): `POST /auth/dev/orgs`-driven login via `POST /auth/dev-login {orgSlug,email}`.
- Kiorex / Kiorly Clinic -> Lab (`/integration/v1/*`): HMAC (`X-Kiorly-Client-Key`, `-Timestamp` ms, `-Nonce`, `-Signature` over `ts\nnonce\nMETHOD\npath\nsha256(body)`), verified with `@kiorex/contracts`. Clients are created by an owner (`POST /integration-clients`, secret shown once).
- Analyzer bridge: `POST /analyzers/ingest` with `x-instrument-key` (key issued by `POST /instruments/:id/api-key`).
- Patient secure link (public): `GET /public/reports/:token`, `POST .../otp`, `POST .../verify`, `GET .../download`.

## Errors
JSON `{statusCode?, code, ...}`. Notable codes: `FEATURE_DISABLED {key,scope}` (403), `PLAN_REQUIRED {capability}` (402), `LABEL_MISMATCH`, `ACCESSION_DUPLICATE`, `QC_BLOCK_OPEN`/`QC_BLOCKED`, `REPORT_NOT_READY`, `CONSENT_REQUIRED`, `NOT_AUTHORIZED_SIGNATORY`, `SAFETY_INVARIANT` (database trigger/CHECK refusal).

## Idempotency
`Idempotency-Key` is required on payments (`POST /invoices/:id/payments`, unique per tenant) and home-collection confirmation (offline queue replay). External orders are idempotent on `(org, source, sourceRef)`.

## Outbox events (HMAC webhook to Kiorex)
Body `{eventId,type,aggregateType,aggregateId,target:"KIOREX",occurredAt,data}`, headers `X-Kiorly-Event`, `-Event-Id`, `-Timestamp` (s), `-Signature: sha256=hex(HMAC(secret, "<ts>.<body>"))`. At-least-once with backoff; receivers de-duplicate on `eventId`.

| Type | Contract | Notes |
|---|---|---|
| `LabResultReleased` | published (`@kiorex/contracts`) | validated against the schema before it is stored; signed report version + secure link, never raw values |
| `LabOrderCreated`, `LabOrderStatusChanged` | local draft (NH-LB-025) | Kiorex bookings / Clinic handoff only |
| `LabCriticalEscalated`, `LabReportCorrected` | local draft | no values |
| `LabInvoiceIssued`, `LabPaymentRecorded` | local draft | Kiorex-sourced orders only |

## Module map
catalogue `/catalogue/*` · orders `/orders`, `/patients`, `/home-collection*` · specimens `/specimens*`, `/orders/:id/accession` · QC `/instruments`, `/qc/*`, `/auto-verification` · results `/results*`, `/worklist`, `/validation-queue` · analyzers `/analyzers/*` · release `/release-queue`, `/orders/:id/reports`, `/reports/:id/release|pdf` · critical `/critical-alerts`, `/critical-rules` · business `/price-lists`, `/b2b-accounts`, `/invoices`, `/payments`, `/cash-closes`, `/tat`, `/exports/:kind.csv`, `/statements/referring-doctors`, `/send-out-costs` · admin `/auth/me`, `/onboarding/*`, `/staff`, `/rbac`, `/labs`, `/settings`, `/audit-logs`, `/dev/inbox`.
