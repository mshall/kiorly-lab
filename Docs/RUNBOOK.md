# Kiorly Lab - Kiorex integration runbook

- **Ports**: API 3200 (`/api/v1`; Kiorex machine API `/api/v1/integration/v1`), web 5191. Dev DB `kiorly_lab` on :5433.
- **Register Kiorex**: owner `POST /api/v1/integration-clients {source:"KIOREX_BOOKING", kiorexBaseUrl}` -> `{key, secret, webhookSecret}` (shown once). Dev: `npm run db:seed -w api` registers `kl_dev_kiorex` (INTEGRATION.md).
- **Run against Kiorex**: `KIOREX_MODE=real KIOREX_BASE_URL=http://localhost:4000 FLAGS_POLL_ENABLED=true KIOREX_PRODUCT_KEY=ff_kiorly-lab_dev KIOREX_PRODUCT_SECRET=ff_dev_secret_change_me OUTBOX_POLL_INTERVAL_MS=1000`.
- **Stuck events**: `OutboxEvent.status=FAILED` after 10 attempts -> fix the cause and reset to PENDING; Kiorex de-duplicates on eventId.
- **Flag snapshot 401**: the poll must be signed with the contract helper (ms timestamp, query-less path); fixed in this repo, do not hand-roll signatures.
