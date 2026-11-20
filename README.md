# Kiorly Lab

> **QA / demo data:** synthetic Egyptian dataset, logins, URLs and reset instructions in [Docs/TEST_DATA.md](Docs/TEST_DATA.md) (DEV ONLY).

Laboratory information management for independent labs and small chains: orders, accession, chain of custody, analyzers, QC, authorised release, critical values, billing, and Kiorex test bookings with home collection (KX-07).

> **Status: MVP built, mock providers only.** Schema is FROZEN-v1 (engineering freeze, human approval NH-LB-023 open). Open human items: `Docs/NEEDS_HUMAN.md`. Build tracker: `Docs/lab-cursor-build-sequence.md` §5.

Part of Kiorly by Kiorex. Works standalone; talks to Kiorex only over HMAC REST + outbox webhooks (KX-09). Never imports another product's source or DB.

> **No tax-authority reporting** (ADR-011): VAT appears as a line on invoices and in CSV/PDF exports for the lab's accountant. Nothing is ever submitted to any authority (`no-tax-authority.node.test.ts` enforces it).
> **Providers are mocked** (`MODE=mock|real`): messaging, PSP, object storage, analyzers, Kiorex webhooks. Go-live list: `Docs/NEEDS_HUMAN.md`.

## Layout

| Path | What |
|---|---|
| `apps/api` | NestJS 10 + Prisma 6. Modules: `catalogue`, `orders` (patients, consent, home collection, nurse-collected samples), `field-safety` (home-collection lifecycle on `@kiorly/field-visit`, safety timer, SOS, unsafe-abort), `specimens` (accession, labels, custody), `analysis-qc` (instruments, Westgard QC, results, validation), `analyzers` (ASTM E1394 / HL7 v2 parsers, bridge, simulator), `critical`, `release` (signed report versions, PDF, secure link), `business` (price lists, invoices, payments, TAT, exports), `admin` (auth session, onboarding, staff/RBAC) |
| `apps/api/src/kernel-adapter` | Seam for `@kiorly/commerce-kernel` (not published yet): entitlements, price book, ledger. Local implementation behind three provider tokens |
| `apps/api/src/{adapters,outbox,integration}` | Mock/real adapters (messaging, storage, PSP), transactional outbox + HMAC dispatcher, inbound HMAC endpoints, flag webhook |
| `apps/api/prisma` | Schema (FROZEN-v1) + migrations `0001_draft_init`, `0002_freeze_v1` (DB triggers/CHECKs for the safety controls) |
| `apps/web` | React 18 + Vite + Tailwind + TanStack Query + i18next (AR/EN, RTL). Lab console, collector PWA at `/phleb`, patient secure link at `/r/:token`, onboarding |
| `packages/shared` | Product constants, flag keys, safety controls |
| `Docs/` | Build sequence + tracker, NEEDS_HUMAN (incl. Provider go-live), API notes, `openapi.json`, design notes, ADR reference |

## Run locally

Prereqs: Node >= 22, workspace Postgres on :5433 (see workspace `CLAUDE.md`).

```bash
npm install
cp .env.example apps/api/.env       # DATABASE_URL -> kiorly_lab on :5433
npm run db:setup                    # creates kiorly_lab + kiorly_lab_test, applies migrations
npm run db:seed -w api              # synthetic demo tenant "demo-lab" (idempotent)
npm run dev                         # API http://localhost:3200/api/v1 (Swagger /docs) · web http://localhost:5191
```

Sign in at http://localhost:5191 (dev auth): lab **Demo Diagnostics (synthetic)**, users `owner|director|signatory|tech|phleb|reception|manager@demo-lab.test`. The seed also leaves an open QC block (TSH on the HL7 analyzer), a critical haemoglobin alert and a home-collection route for today. Dev HMAC clients: `kl_dev_kiorex` / `kl_dev_clinic` (secrets printed by the seed).

| Service | URL |
|---|---|
| API | http://localhost:3200/api/v1 (`/health/live`, `/ready`, Swagger at `/docs`) |
| Web | http://localhost:5191 (proxies `/api`) |
| DB | postgresql://postgres:postgres@127.0.0.1:5433/kiorly_lab (tests use `kiorly_lab_test`) |

## Checks

```bash
npm run typecheck   # api (prisma generate + tsc) + web
npm run lint        # web
npm test            # api: unit + property-based + e2e (stop-ship, OFF contract, integration, ...); web: locale parity + i18n coverage
npm run docs:check
npm run openapi -w api   # regenerates Docs/openapi.json
npm run e2e -w web       # Playwright golden flow in system Chrome (starts its own API/web on the test DB)
```

Tests run against `kiorly_lab_test` (never the dev DB). Highlights: KX-07 stop-ship suite (`safety-stop-ship.e2e.test.ts`: QC violation injection, critical timer, label mismatch, duplicate accession replay), OFF contract tests for all four flags and the never-flag proof (`flags-off.e2e.test.ts`), Westgard property tests, ASTM/HL7 fixture parsers, contract tests against `@kiorex/contracts`, tenancy/RBAC/MFA, money-path idempotency + reconciliation.

## Feature flags and safety controls

Flags (`lab.module`, `lab.analyzer_interfaces`, `lab.home_collection`, `lab.kiorex_bookings`) are evaluated locally from the Kiorex snapshot (cached in `FlagSnapshotCache`, polled every 30 s with `If-None-Match`, refreshed by the `flag.changed` webhook). OFF => `403 FEATURE_DISABLED {key,scope}`; data is never hidden. **Safety controls are never flags** (ADR-025): QC blocks, authorised release, critical-value escalation, accession uniqueness, custody, label match, consent, audit, tenant isolation, privileged MFA. See `Docs/ADR_REFERENCE.md`.

## Rules

See `.cursor/rules/lab.mdc` and the workspace `CLAUDE.md`. Conventional Commits with KL IDs. No push to `main` without review; no AWS deploys until the founder says so.
