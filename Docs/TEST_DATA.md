# Test data — Kiorly Lab (DEV ONLY)

> **DEV ONLY / synthetic.** Fictional names, phones `+20100000xxxx`, e-mails `@demo.kiorex.test`. Passwords and OTPs here are local dev values, blocked in production.
> No tax-authority integration; VAT is a plain configurable line. Messaging/PSP/video are mocked. Cross-product index: `TEST_DATA.md` in the workspace root (`kiorex-v2/`).

## Run / reset
```bash
cd apps/api
npm run db:seed          # base demo tenant demo-lab (catalogue, QC history incl. a failing TSH run, 6 sample orders)
npm run db:seed:demo     # idempotent (skips if "(DEMO)" patients exist): ~34 more orders, QC history, home-collection stops, Kiorex bookings
```
`--reset` is **not possible** for released reports, QC runs and audit (append-only by DB triggers); full wipe = recreate the `kiorly_lab` database, then both seeds.
## Logins — http://localhost:5191 (dev auth, no passwords; DEV ONLY)
Dev-login screen: org `demo-lab`, then pick Owner / Director / Signatory / Technologist / Phlebotomist / Reception / Manager (`<role>@demo-lab.test`). API: `POST /api/v1/auth/dev-login {"orgSlug":"demo-lab","email":"signatory@demo-lab.test"}`. Passport persona for the lab org: `+201000002005` (OTP `000000`).
## What exists
Orders for the Passport demo patients (`… (DEMO)`) in every status: awaiting collection (6), collected (3), in lab (3), awaiting technical validation (3), validated (2), released with invoices/payments (up to 12; some unpaid), critical alerts (HB 5.9, K 6.8), home-collection stops today for the phlebotomist, Kiorex bookings `kx_lb_demo_3…7` (submitted, collected, 2 released, rejected) mirroring the Kiorex bookings of the same id · QC: 20 more days of in-control runs on both analyzers + the base failing run · B2B payer account.
## Where to click
Dashboard · Orders · Accessioning · Worklist · Validation · QC · Release · Critical · Billing · Reports · `/phleb` (phlebotomist app).
