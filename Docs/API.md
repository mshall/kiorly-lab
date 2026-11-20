# Kiorly Lab API notes

Machine-readable spec: [`openapi.json`](./openapi.json) (regenerate with `npm run openapi -w api`); live Swagger at `/docs`. Base path `/api/v1`.

## Auth
- Staff: `Authorization: Bearer <JWT>`. Production (`AUTH_MODE=oidc`): Kiorex Account RS256 access token, `iss`/`aud` validated against JWKS; roles and tenant always come from the lab database (`StaffUser`), never from the token or headers. Privileged roles (owner, lab director, authorised signatory) need an MFA `amr` claim in production.
- Dev (`AUTH_MODE=dev`, disabled when `NODE_ENV=production`): `POST /auth/dev/orgs`-driven login via `POST /auth/dev-login {orgSlug,email}`.
- Kiorex / Kiorly Clinic -> Lab (`/integration/v1/*`): HMAC (`X-Kiorly-Client-Key`, `-Timestamp` ms, `-Nonce`, `-Signature` over `ts\nnonce\nMETHOD\npath\nsha256(body)`), verified with `@kiorex/contracts`. Clients are created by an owner (`POST /integration-clients`, secret shown once).
- Analyzer bridge: `POST /analyzers/ingest` with `x-instrument-key` (key issued by `POST /instruments/:id/api-key`).
- Patient secure link (public): `GET /public/reports/:token`, `POST .../otp`, `POST .../verify`, `GET .../download`.

## Errors
JSON `{statusCode?, code, ...}`. Notable codes: `FEATURE_DISABLED {key,scope}` (403), `PLAN_REQUIRED {capability}` (402), `LABEL_MISMATCH`, `ACCESSION_DUPLICATE`, `QC_BLOCK_OPEN`/`QC_BLOCKED`, `REPORT_NOT_READY`, `CONSENT_REQUIRED`, `NOT_AUTHORIZED_SIGNATORY`, `SAFETY_INVARIANT` (database trigger/CHECK refusal), `OUT_OF_COVERAGE`, `PHLEBOTOMIST_UNAVAILABLE`, `SAFETY_CONTACT_REQUIRED`, `GEOSTAMP_REQUIRED`, `NO_SHOW_NOT_ALLOWED`, `SAMPLE_MISSING_FOR_TEST` / `SAMPLE_UNMATCHED` / `SAMPLE_DUPLICATE_GROUP`, `COLLECTED_IN_FUTURE`, `HANDOVER_TIME_INVALID`.

## Idempotency
`Idempotency-Key` is required on payments (`POST /invoices/:id/payments`, unique per tenant) and home-collection confirmation (offline queue replay). External orders are idempotent on `(org, source, sourceRef)`.

## Outbox events (HMAC webhook to Kiorex)
Body `{eventId,type,aggregateType,aggregateId,target:"KIOREX",occurredAt,data}`, headers `X-Kiorly-Event`, `-Event-Id`, `-Timestamp` (s), `-Signature: sha256=hex(HMAC(secret, "<ts>.<body>"))`. At-least-once with backoff; receivers de-duplicate on `eventId`.

| Type | Contract | Notes |
|---|---|---|
| `LabResultReleased` | published (`@kiorex/contracts`) | validated against the schema before it is stored; signed report version + secure link, never raw values |
| `LabOrderCreated`, `LabOrderStatusChanged` | local draft (NH-LB-025) | Kiorex bookings / Clinic handoff / nurse samples only; nurse orders go out as `source: KIORLY_CLINIC` + additive `originEdition: "NURSE"` (Nurse is an edition of Clinic) |
| `LabCriticalEscalated`, `LabReportCorrected` | local draft | no values |
| `LabInvoiceIssued`, `LabPaymentRecorded` | local draft | Kiorex-sourced orders only |

## Home collection and collector safety (KLORD04, `@kiorly/field-visit`)
Lifecycle `SCHEDULED -> EN_ROUTE -> ARRIVED -> COLLECTED` (package states CONFIRMED / ON_MY_WAY / ARRIVED / FINISHED; `FAILED` = no-show or could-not-collect, `ABORTED_UNSAFE`, `CANCELLED`). Feature endpoints (`lab.home_collection` + `home_collection` entitlement): `GET /home-collection/slots`, `GET /home-collections`, `GET /home-collections/my-route`, `POST /home-collections/:id/assign` (409 `PHLEBOTOMIST_UNAVAILABLE {reason: OVERLAP|DAILY_CAP|TRAVEL_INFEASIBLE}`), `/start {geostamp?}` (409 `SAFETY_CONTACT_REQUIRED`), `/arrive {geostamp}` (check-in), `/label-photo`, `/confirm` (needs ARRIVED), `/fail`. Booking: `homeCollection.districtId` (and `collection.districtId` on the inbound order) is checked against the lab coverage zone: 422 `OUT_OF_COVERAGE {reason: NO_DISTRICT|DISTRICT_NOT_COVERED|TRAVEL_TOO_LONG|TRAVEL_UNKNOWN}`. Config: `PUT /labs/:id/coverage {districtIds, maxTravelMinutes?, startDistrictId?, travelMatrix?}`, `PUT /settings {safetyContactName, safetyContactPhone, homeBufferBeforeMin, homeBufferAfterMin, homeDailyCap}`.
Address, phone and coordinates are returned only to the assigned phlebotomist and OWNER / LAB_DIRECTOR / BRANCH_MANAGER, once confirmed and never 24 h after the visit ended (`addressMasked: true` otherwise, district only). Geostamps are coarsened to ~1 km.
**Safety endpoints (never behind a flag or plan, ADR-025)**: `POST /home-collections/:id/safety/answer` ("I'm OK"), `/sos {lat,lng}` (live location to the safety contact, response `{delivered, show: {ambulance:"123", police:"122"}}`), `/leave-unsafe {reason: THREAT_OR_AGGRESSION|UNSAFE_ENVIRONMENT|ANIMAL|OTHER, geostamp?}` (never a no-show: a later `/fail` is 409 `NO_SHOW_NOT_ALLOWED`), `GET /home-collections/safety/alerts`. The safety timer (tick 10 s, runs in every environment except `NODE_ENV=test`) prompts the collector 30 min after the planned end and alerts the safety contact 10 min later; undelivered alerts are retried every tick. See `Docs/FIELD_VISIT.md`.

## Nurse-collected samples (KLORD05 / KNLAB01)
`POST /integration/v1/orders` from a `KIORLY_NURSE` client carries the ratified (contracts 1.6.0) `nurseCollection {visitRef, collectorRef, collectorName?, collectedAt, handedOverAt?, temperatureC?, consentToken, samples[{label, specimenType, container?}]}` plus `identifiersChecked` (>= 2). `GET /integration/v1/orders/:sourceRef/custody` (nurse / clinic clients) returns the chain (NURSE | LAB, times, temperature, no PHI). `GET /integration/v1/reports/:id/pdf` serves a nurse client only after a release on `KIORLY_NURSE_IMPORT`. See `Docs/NURSE_SAMPLES.md`.

## Module map
catalogue `/catalogue/*` · orders `/orders`, `/patients`, `/home-collection*` · specimens `/specimens*`, `/orders/:id/accession` · QC `/instruments`, `/qc/*`, `/auto-verification` · results `/results*`, `/worklist`, `/validation-queue` · analyzers `/analyzers/*` · release `/release-queue`, `/orders/:id/reports`, `/reports/:id/release|pdf` · critical `/critical-alerts`, `/critical-rules` · business `/price-lists`, `/b2b-accounts`, `/invoices`, `/payments`, `/cash-closes`, `/tat`, `/exports/:kind.csv`, `/statements/referring-doctors`, `/send-out-costs` · admin `/auth/me`, `/onboarding/*`, `/staff`, `/rbac`, `/labs`, `/settings`, `/audit-logs`, `/dev/inbox`.
