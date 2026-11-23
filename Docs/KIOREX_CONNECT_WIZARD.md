# Connect to Kiorex (Kiorly Lab), ADR-040

Kiorly Lab works fully on its own. **Connect to Kiorex** (`/kiorex-connect`) guides an organisation that started standalone through joining the marketplace later.

- **Checklist.** `GET /api/v1/kiorex-connect` returns the steps computed from real state, each `done | action_needed | waiting_kiorex | blocked`, with a deep link to fix it. Lab site, test catalogue, price list completeness (every active test priced on the default list), opening hours, optional home collection, licence number per lab and an uploaded licence document, payout LABEL placeholder, terms. State is an append-only snapshot in `AuditLog` (`entityType KiorexConnect`): no schema change.
- **Request.** `POST /api/v1/kiorex-connect/request` issues a `KIOREX_BOOKING` client, switches the tenant to INTEGRATED, and sends the signed request. Kiorex runs a signed handshake against `/integration/v1/tests`.
- **Secrets.** Stored sealed in `IntegrationClient`; returned only in the rotation response; never logged or audited.
- **Status.** The product polls Kiorex with a status token it derives itself (HMAC of the organisation id); nothing is stored. Rejection returns the organisation to standalone.
- **After Go live.** The page offers to make Kiorex Passport the default sign-in (`defaultSignInMethod`) and to invite staff to link their phone.
- **Tests.** ``integration/kiorex-connect.node.test.ts`, `web/src/features/kiorex/kiorex-connect.node.test.ts``; end to end: `e2e/test/22-standalone-connect.e2e.ts` in the workspace repo.
- **Not done / needs a human.** Counsel-approved terms and fee wording, real notification providers, real launch-gate evidence, the production signing of the request with a per-partner enrolment secret (today the Clinic uses the shared webhook secret and Pharmacy/Lab prove control of their API through the signed handshake).
