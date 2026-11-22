# Providers: mock today, real by configuration only

Every external provider sits behind a port with `<KIND>_MODE=mock|real` (default `mock`). Going live means setting env/secrets, **not** writing code. The same env names, generic request/response shapes and webhook scheme are used by Kiorly Clinic, Pharmacy and Lab.

| Kind | Port (code) | Switch | Mapping file (the only vendor-specific code) |
|---|---|---|---|
| SMS | `src/adapters/messaging.adapter.ts` -> `src/providers/messaging-provider.ts` | `SMS_MODE` | `src/providers/mapping/sms.mapping.ts` |
| Email | same | `EMAIL_MODE` | `.../email.mapping.ts` |
| WhatsApp | same | `WHATSAPP_MODE` | `.../whatsapp.mapping.ts` |
| Payment (PSP, pay-by-link, refund) | `src/adapters/psp.adapter.ts` -> `src/providers/payment-provider.ts` | `PAYMENT_MODE` | `.../payment.mapping.ts` |
| Push (Kiorly Team) | `src/adapters/mobile-push.adapter.ts` -> `src/providers/push-provider.ts` | `PUSH_MODE` (legacy `MOBILE_PUSH_MODE`) | n/a (Expo-compatible gateway) |
| Storage | `src/adapters/storage.adapter.ts` (HTTP object store) | `STORAGE_MODE` | n/a (`PUT/GET {url}/{key}`) |

`MESSAGING_MODE` / `PSP_MODE` still work as the default for the three messaging kinds / PAYMENT.

## Env contract (per kind)
`<KIND>_MODE`, `<KIND>_API_URL` (base URL of the provider or your gateway), `<KIND>_API_KEY` (bearer), `<KIND>_WEBHOOK_SECRET` (HMAC for callbacks), plus `SMS_SENDER_ID`, `EMAIL_FROM`, `WHATSAPP_SENDER_ID`. Optional `<KIND>_TIMEOUT_MS` (8000), `_MAX_RETRIES` (2), `_BACKOFF_MS` (300). Kinds: `SMS`, `EMAIL`, `WHATSAPP`, `PAYMENT`.

**Fail-fast:** `main.ts` calls `assertProviderConfig()` before listening. `MODE=real` without URL, key, webhook secret or sender id (or a non-https URL in production) aborts startup listing the missing variable NAMES; values and secrets are never logged.

## Generic shapes (identical across repos)
* Send message: `POST {URL}/messages` `{to, from, text, reference, templateId, locale}` (email adds `subject`/`html`; WhatsApp sends `template:{name,language,params}`) -> `{id, status}`. Headers: `Authorization: Bearer <KEY>`, `Idempotency-Key` (= our notification row id, identical on every retry).
* PSP: `POST {URL}/charges` -> `{id, status: captured|declined|pending}`; `POST {URL}/pay-links` `{amount,currency,reference,description,expiresAt,customer}` -> `{id, payUrl}`; `POST {URL}/refunds` `{chargeId,amount,currency,reason}` -> `{id, status: succeeded|pending}`.
* Retries: network errors, timeouts, 408, 429 (honours Retry-After) and 5xx, with exponential backoff + jitter; 401/403/4xx are never retried. Errors map to `TIMEOUT | NETWORK | AUTH | RATE_LIMITED | REJECTED | PROVIDER_5XX | BAD_RESPONSE`; a failed send is stored as `FAILED` with `CODE: message` (never a secret or message body).
* Real sends inside a caller's DB transaction are deferred until after commit (QUEUED row + dispatcher), so a slow provider never holds a transaction open.

## Webhooks (delivery receipts, payment status)
`POST /api/v1/webhooks/providers/{sms|email|whatsapp|payment}` (public route, HMAC authenticated). Header `X-Kiorex-Signature: t=<unix>,v1=<hex HMAC-SHA256("<t>.<raw body>", <KIND>_WEBHOOK_SECRET)>`, 5 minute tolerance. Body `{id, type, createdAt, data:{id, error?, amount?, currency?, reference?}}` (or `{events:[...]}`), types `message.sent|delivered|read|failed`, `payment.succeeded|failed|expired`, `refund.succeeded|failed`. Events are deduplicated by `id` (`ProviderWebhookEvent`); receipts never downgrade a state (a late `failed` does not override `delivered`). A vendor with a different signature or payload is adapted in the kind's mapping file.

State is persisted in `NotificationAttempt` (status, providerMessageId, error, deliveredAt) and `PayLink` (+ the booked `Payment` / `Refund`).

## Flows (all work in mock mode)
* Lab result-ready: release/deliver report -> WhatsApp/SMS/email (`TODO_NEEDS_HUMAN_REPORT_DELIVERY`); critical alert: WhatsApp + **SMS** to the referring doctor (order number only, never a value); invoice/receipt email: `POST /invoices/:id/send {kind: INVOICE|RECEIPT, channel, to?}`.
* Pay-by-link: `POST /invoices/:id/pay-link {amount?, sendVia?}` -> `payment.succeeded` books one Payment + ledger entry and emails/SMSes a receipt; `payment.failed|expired` closes the link; `POST /pay-links/:id/refund` refunds through the PSP (a pending refund is booked on `refund.succeeded`).

## Dev-only tools (404 in production or with `PROVIDER_DEV_TOOLS=false`; need `settings.manage`)
* `GET /api/v1/dev/providers/status` (modes, which credentials are set: booleans only)
* `GET /api/v1/dev/providers/messages?channel=` (everything "sent", with the rendered body)
* `GET /api/v1/dev/providers/pay-links`
* `POST /api/v1/dev/providers/simulate/webhook {kind, type, providerRef, error?, amount?}` (signed with the kind's secret and sent through the same verify/dedupe/apply path; mock mode only)
* `POST /api/v1/dev/providers/demo/run {payments?: false}` runs every flow: result-ready (WhatsApp + email), critical SMS, invoice email, delivery receipts, then pay-by-link success -> refund and a failing link on the newest payable invoice.

Tests: `src/providers/providers.node.test.ts` (fail-fast, signatures, retry/timeout/error mapping against a local fake HTTP server) and `test/providers.e2e.test.ts` (mock end to end; real mode against the fake provider; webhook auth/dedupe; refund pending/failed).
