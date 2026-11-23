# Kiorly Lab - runbook

## Running locally
- **Ports**: API 3200 (`/api/v1`), web 5193, Postgres 5433 (db `kiorly_lab`, tests `kiorly_lab_test`). If another process owns a port, run beside it with `PORT=3201` (API) and `LAB_WEB_PORT=5194 LAB_API_ORIGIN=http://127.0.0.1:3201` (web).
- **Database**: `npm run db:setup` (creates the databases, applies migrations). New migrations: `apps/api/scripts/new-migration.sh <name>` (non-interactive: diffs against a throwaway shadow DB, writes the folder, applies it).
- **Seeds** (synthetic, guarded by `DEMO_SEED_ALLOWED=true` + non-production environment): `npm run db:seed -w api` (base tenant `demo-lab` **plus the LIS dataset**), `npm run db:seed:demo -w api` (nurse/Kiorex orders), `npm run db:seed:lis -w api` (LIS dataset only, idempotent; for tenants seeded before the LIS modules existed). Logins `<role>@demo-lab.test` for owner, director, signatory, tech, supervisor, phleb, reception, finance, manager.
- **Tests**: `npm test` (api unit + e2e on `kiorly_lab_test`, then web), `npm run test:e2e -w api`, `npm run e2e -w web` (Playwright; override ports with `LAB_E2E_API_PORT` / `LAB_E2E_WEB_PORT`).

## Standalone vs integrated
- **Choose**: Settings > General > Operating mode, or `PUT /api/v1/settings {"integrationMode":"STANDALONE"|"INTEGRATED"}` (owner / manager with `settings.manage`). Self-serve onboarding creates STANDALONE tenants; tenants created before the setting existed are INTEGRATED.
- **STANDALONE**: no external service is contacted or accepted. Partner requests are refused `403 INTEGRATION_DISABLED`; `OutboxService.enqueue` validates the event and drops it (no rows), so there is nothing to retry. Delivery of reports to patients/doctors uses the (mock) messaging adapter and secure links only. Nothing to configure, nothing to monitor beyond the app and the database.
- **INTEGRATED**: register partners with `POST /integration-clients {source:"KIOREX_BOOKING"|"KIORLY_CLINIC"|"KIORLY_NURSE", kiorexBaseUrl?}` (secret shown once). Dev registers `kl_dev_kiorex`, `kl_dev_clinic`, `kl_dev_nurse`. Run against Kiorex: `KIOREX_MODE=real KIOREX_BASE_URL=http://localhost:4000 FLAGS_POLL_ENABLED=true KIOREX_PRODUCT_KEY=ff_kiorly-lab_dev KIOREX_PRODUCT_SECRET=ff_dev_secret_change_me OUTBOX_POLL_INTERVAL_MS=1000`.
- **Switching INTEGRATED -> STANDALONE**: pending outbox rows stay and are delivered if you switch back; new events are not recorded while standalone. Switching back does not replay events produced meanwhile (a standalone lab never told the partner about them).
- **Stuck events** (integrated): `OutboxEvent.status=FAILED` after 10 attempts -> fix the cause and reset to PENDING; Kiorex de-duplicates on eventId. Flag snapshot 401: sign the poll with the contract helper (ms timestamp, query-less path).

## Day-to-day operations
- **Reception**: `/reception` queue and appointments; `/queue-board` is the waiting-room screen (codes only, no names; open it full-screen on a TV browser logged in as reception).
- **QC**: run controls daily; a failed run opens a QC block and sends unreleased results back; clearing needs a documented passing run (`qc.clear_block`). Retire expired lots in Quality > QC lots (retired or expired lots refuse runs).
- **Inventory**: consumption is automatic on the first result of an order item and on every rerun (FEFO). A shortfall never blocks a result: it is logged as a movement with `shortfall` and shown on the Inventory KPIs. Dispose expired stock and run counts monthly.
- **Retention**: stored samples are kept per `RetentionRule` (default 7 days); Storage > Disposal due lists what can go.
- **Reports**: a report is rendered once at signing with the active template and stored; changing a template never alters a signed report. The QR on every report opens `/verify/:reportId` (genuine / superseded, no patient data).
- **Backups**: append-only tables (audit, custody, QC runs, ledgers, stock movements, refunds, consents, report versions) are protected by DB triggers; restore from DB backups, never by editing rows. Seeds cannot be re-run to "reset" released data: recreate the database.
- **Doctor portal links**: issued per referrer (Referrers > Doctor portal); only the token hash is stored; revoke or re-issue any time. Reports are downloadable only when released **and** the patient consented to the `REFERRER_PORTAL` channel.
