# Kiorly Lab: demo data and manual test guide (DEV ONLY)

> **DEV ONLY / synthetic.** Fictional labs, patients and results. The lab demo uses **dev authentication: no passwords** (`AUTH_MODE=dev`, refused in production). Providers are mocked. Workspace index: [../DEMO_DATA.md](../DEMO_DATA.md) · shared tables: [../TEST_DATA.md](../TEST_DATA.md) · seed reference: [Docs/TEST_DATA.md](Docs/TEST_DATA.md) · feature coverage: [Docs/FEATURE_MATRIX.md](Docs/FEATURE_MATRIX.md).
> Checked against the API on `:3200` and the `kiorly_lab` database on 21 Nov 2026. The dev DB is also written by the e2e suites, so **counts drift**; the states listed are what the seeds guarantee.

## 1. What this demo is for

A full LIS: catalogue (257 test definitions in the DB, panels, calculated analytes), registry, orders in every status, accessioning and custody, worklist, results with delta checks, technical then medical validation, release, critical-value alerts with escalation, QC (Westgard) with a failing run, microbiology and histology, inventory, finance and quality, a phlebotomist home-collection route, the Kiorex booking channel and the **Kiorly Nurse sample channel (KNLAB01)**. Three tenants show the editions: `demo-lab` (PRO), `chain-lab` (ENTERPRISE chain) and `basic-lab` (BASIC / Lite, gated).

## 2. Start and seed

```bash
e2e/scripts/up.sh [--build] [--seed]          # workspace root: Lab API :3200 (AUTH_MODE=dev, KIOREX_MODE=real)
cd kiorly-lab && npm run dev -w web            # web on http://localhost:5193 (proxies /api to :3200; port from LAB_WEB_PORT, default 5193)
cd kiorly-lab/apps/api
npm run db:seed          # base tenant demo-lab (catalogue, QC history incl. a failing run, 6 sample orders) + LIS dataset
npm run db:seed:demo     # idempotent (skips if "(DEMO)" patients exist): ~34 more orders, QC history, home-collection stops, Kiorex bookings
npm run db:seed:lis      # the LIS dataset alone (marker supplier "MedSupply (demo)"; idempotent)
npm run db:seed:mobile   # Kiorly Team tenants chain-lab and basic-lab + alerts (idempotent; run by scripts/seed-all.sh right after db:seed:demo)
```

* **No reset:** released reports, QC runs and the audit log are append-only (DB triggers). A full wipe means recreating the `kiorly_lab` database, then both seeds. `seed-all.sh --reset` only re-creates what it can.
* **Ports:** the web dev port is configurable and defaults to **5193** (`LAB_WEB_PORT=<port> npm run dev -w web`; API origin override `LAB_API_ORIGIN`). It used to be 5191, which is the Kiorly Clinic *main* checkout's docs server (its web is on 5190), so Pharmacy and Lab webs now default to 5192 / 5193.
* Run the API beside another stack with `PORT=3201`, then `LAB_WEB_PORT=5194 LAB_API_ORIGIN=http://127.0.0.1:3201`.
* The hand-off file `.e2e/demo-handoff.json` written by the Lab demo seed is read by the Kiorex seed (nurse samples); order numbers and ids differ per database.

## 3. Personas (dev-login screen: organisation slug, then pick the role; API `POST :3200/api/v1/auth/dev-login {"orgSlug","email"}`)

Every tenant has one login per role: `<role>@<slug>.test`, no password. All 27 were verified against the API on 21 Nov 2026. A Passport persona for the lab org exists: `+201000002005` Dina Wagdy (lab technician member of "Cairo Diagnostics Lab (DEMO)", OTP `000000`).

| Login (`demo-lab` = `<role>@demo-lab.test`) | Name | Role | Permissions | Web app role |
|---|---|---|---|---|
| `owner@demo-lab.test` | Layla Owner | OWNER | 64 (all) | everything, settings, staff |
| `director@demo-lab.test` | Dr. Karim Director | LAB_DIRECTOR | 64 (all) | as owner |
| `signatory@demo-lab.test` | Dr. Salma Signatory | AUTHORIZED_SIGNATORY (pathologist) | 24: medical validation, correct, sign, release, ack critical, clear QC block, histo/micro report, documents approve | validation + release + critical |
| `tech@demo-lab.test` | Omar Technologist | TECHNOLOGIST | 28: enter + second-entry results, technical validation, QC run, instruments, receive/process/reject specimens, storage, manifests | worklist, QC, accessioning |
| `phleb@demo-lab.test` | Nour Phlebotomist | PHLEBOTOMIST | 7: read orders/patients, label + collect specimens, perform collection | `/phleb` home-collection app |
| `reception@demo-lab.test` | Mona Reception | RECEPTION | 22: register patients, create/cancel/edit orders, queue, appointments, invoice + payments + cash close, release/deliver reports | reception, billing, queue board |
| `manager@demo-lab.test` | Hassan Manager | BRANCH_MANAGER | 40: orders, billing + pricing, staff, catalogue write, inventory, quality, templates, expenses | operations |
| `supervisor@demo-lab.test` | Rania Supervisor | SUPERVISOR | 46: bench + QC + quality + inventory + analytics, no signing | bench supervision |
| `finance@demo-lab.test` | Fady Finance | FINANCE | 17: billing, pricing, commissions, expenses, exports, analytics | finance |

| Tenant slug | Name | Edition / plan | Logins | Behaviour |
|---|---|---|---|---|
| `demo-lab` | Demo Diagnostics (synthetic) | PRO (INTEGRATED) | 9 roles above | full app; the busy tenant |
| `chain-lab` | Delta Diagnostics Group (synthetic) | CHAIN = ENTERPRISE | same 9 at `@chain-lab.test` | small: a pending phlebotomy order, an in-lab specimen, an awaiting-sign-off order, one escalated critical HB |
| `basic-lab` | Starter Lab (synthetic) | LITE = BASIC | same 9 at `@basic-lab.test` | web works; Kiorly Team shows the upgrade screen + safety-alert inbox |

Dev HMAC partner clients (DEV ONLY, for the Kiorex / Clinic links): `kl_dev_kiorex`, `kl_dev_clinic`, `kl_dev_nurse` (secrets in the seed / `INTEGRATION.md`).

## 4. What data exists (snapshot 21 Nov 2026, tenant `demo-lab`) and where to click

| Data | Detail | Where to click |
|---|---|---|
| Orders (248) | RELEASED 92, AWAITING_COLLECTION 75, CANCELLED 40, IN_LAB 14, AWAITING_VALIDATION 11, COLLECTED 8, VALIDATED 7, PARTIALLY_RESULTED 1. Sources: WALK_IN, KIOREX_BOOKING, KIORLY_NURSE (the base seed plus the demo seed create roughly 40-50; the rest are test leftovers) | Orders (`/orders`), Worklist, Validation, Release |
| **Critical values** | one alert is deliberately **OPEN** (not escalated): potassium K 6.9 mmol/L on the order whose referring doctor is `DEMO-OPEN-ALERT-001 (Dr Tamer Shawky, DEMO)` (its ack deadline is a year out so the scheduler never escalates it; `db:seed:demo` re-creates or re-opens it idempotently). The older demo alerts are ESCALATED (level 2, the ack deadline has passed) or, where a test acknowledged them, ACKNOWLEDGED: haemoglobin x3 (HB 5.9 g/dL), potassium (K 6.8 mmol/L), a **positive blood culture** (S. aureus, MRSA screen) ; chain-lab has an escalated HB; basic-lab one more (shown in the app inbox) | Critical (`/critical`) |
| **QC** | 1,580 PASS runs on two analyzers (+ a manual bench); **1 FAIL** (TSH, rule `1_3s`, z = 3.6, level DEMO-L1) (QC_FAILURE alert, severity HIGH); a QC block is cleared by a signatory/supervisor (`qc.clear_block`) | QC (`/qc`) |
| **TAT breaches** | STAT x3 and URGENT x1 turnaround breaches (alerts) | Dashboard, Kiorly Team Lab -> TAT |
| Nurse samples (KNLAB01) | `demo_lo_nl1` RELEASED (signed, report link in the Kiorex vault), `nl2` AWAITING_VALIDATION (results entered + tech validated), `nl3` COLLECTED / specimen in transit (tube `DEMO-NL3-EDTA`), `nl4` REFUSED at hand-off (no order here); order numbers `ORD-2026-000129..131` in the current DB | Accessioning, Validation, Release |
| Kiorex bookings | `kx_lb_demo_3..7` reach the lab: `3` Mariam AWAITING_COLLECTION, `4` Omar COLLECTED, `5` Dalia and `6` Tarek RELEASED, `7` Heba CANCELLED here (REJECTED on the Kiorex side). `kx_lb_demo_1` (Nourhan, PENDING_PAYMENT), `2` (Mahmoud, PAID) and `8` (Youssef, CANCELLED) exist only in Kiorex | Orders (source Kiorex booking) |
| Home collection | `HomeCollection` stops for the phlebotomist's route today (124 rows incl. tests) | `/phleb` as `phleb@` |
| Registry | 67 patient refs; six with multi-visit trends (Hala Fouad T2DM, Omar Sherif CKD, Dina Magdy anaemia, Tarek Nabil lipids, Mona Kamel thyroid, Aya Hassan pregnant) and a duplicate pair `Ahmed Samy` x2 for the merge demo; 6 referrers; 1 B2B account | Patients, Referrers |
| Microbiology / histology | 5 culture cases (E. coli UTI with selective reporting, S. aureus wound, no growth, positive blood culture, incubating), 4 histology / cytology cases | Microbiology |
| Inventory / quality / finance | 3 suppliers, 25 items incl. expiring, expired, quarantined lots, 2 items below reorder; calibrations (one failed -> NCR), EQA (one unacceptable), maintenance (one overdue), NCRs, SOPs; 56 invoices (some unpaid), refunds, payer settlements, aged receivables, closed cash drawer, referrer commission | Inventory, Quality, Finance, Billing |
| Reception | 8 appointments tomorrow, 6 queue tickets (routine + STAT lanes) | Reception, `/queue-board` |
| Public pages | released report link `/r/<token>`, verification `/verify/<id>`, patient portal `/portal/<token>` | from a released order |

## 5. Manual test scripts

**L1. Reception: register, order, invoice (reception@).** 1) Dev-login: org `demo-lab`, role Reception. 2) Orders -> New order: pick a registered patient (e.g. Hala Fouad), add CBC + a lipid panel, priority routine. *Expected:* order AWAITING_COLLECTION with an order number; invoice created, take a cash payment. 3) Queue: issue a ticket in the STAT lane. *Expected:* it appears on `/queue-board`.

**L2. Phlebotomy round (phleb@).** 1) Dev-login as Phlebotomist; open `/phleb`. 2) Today's home-collection stops list. 3) Pick a stop, collect: label tubes, scan. *Expected:* specimen COLLECTED with a custody event; the order moves to COLLECTED. 4) Try to open Validation: absent (the role has 7 permissions).

**L3. Accession, enter, validate, release (tech@ then signatory@).** 1) As Technologist: Accessioning -> receive tube `DEMO-NL3-EDTA`. *Expected:* nurse sample `nl3` becomes received in lab; custody timeline continues the nurse's hand-over. 2) Worklist: enter results for a collected order (a delta check may flag); technically validate. 3) As Signatory: Validation -> `nl2` -> medically validate -> Release. *Expected:* report version created, order RELEASED, report link in the Kiorex vault, the nurse sees the report. 4) Verify the public link `/r/<token>`.

**L4. Critical value (signatory@).** 1) Critical: the OPEN `DEMO-OPEN-ALERT-001` alert (K 6.9) and the escalated HB 5.9 and K 6.8 alerts. 2) Acknowledge one with a note. *Expected:* the alert closes with who and when; reopening shows the audit. 3) The positive blood-culture alert is acknowledged the same way.

**L5. QC failure (tech@ / signatory@).** 1) QC: the TSH run with rule `1_3s` is FAIL and the analyte is blocked. 2) Tech re-runs QC (a passing run) and the signatory clears the block (`qc.clear_block`). *Expected:* the QC failure alert is resolved and the block on TSH is lifted; check Validation for TSH orders before and after.

**L6. Nurse sample to Lab (KNLAB01).** 1) In Kiorly Clinic (../clinics-management/DEMO_DATA.md C10) record a sample for Hoda or Nabila. 2) In Lab: Accessioning -> receive; enter results; validate; release. *Expected:* the clinic nurse sees the status, custody and secure link come back. Refusals: Rana (consent revoked) and Nourhan (never asked) are refused at the clinic with `LAB_HANDOFF_NO_CONSENT`; `nl4` shows the lab-side refusal `SAMPLE_UNMATCHED`.

**L7. Kiorex lab booking.** 1) Kiorex patient web as Omar (`+201000001007`) -> Lab bookings (../kiorex-platform/DEMO_DATA.md K7): `kx_lb_demo_4` is COLLECTED. 2) Lab: Orders (source Kiorex booking): the order for `kx_lb_demo_4` -> enter results, validate, release. *Expected:* Omar's booking becomes RESULT_RELEASED and the result appears in his vault. Dalia (`…1008`) and Tarek (`…1009`) already have released results.

**L8. Edition walkthrough.** `director@chain-lab.test` shows the small chain tenant; `director@basic-lab.test` shows the same web app but the Kiorly Team app is limited to the safety inbox (see ../kiorly-team/DEMO_DATA.md).

**L9. Merge duplicates (supervisor@ or manager@).** Patients -> the two `Ahmed Samy` records -> merge. *Expected:* one survivor, history merged, the merge audited.

## 6. What each role should and should not see

| Role | Should see | Should NOT |
|---|---|---|
| Owner / Director | everything incl. settings, staff, pricing, audit | n/a |
| Signatory (pathologist) | validation, sign, release, correct, critical ack, QC block clear | create orders, billing, instruments, staff |
| Technologist | accessioning, worklist, result entry, tech validation, QC run, instruments | medical validation / signing / release, billing |
| Phlebotomist | `/phleb` route, collection, labels | results, billing, validation |
| Reception | registration, orders, billing, queue, release/deliver reports | result entry, validation, QC |
| Manager | orders, billing + pricing, staff, inventory, quality, expenses | sign / medically validate, QC run |
| Supervisor | bench, QC, quality, inventory, analytics, exports | release / sign reports |
| Finance | billing, pricing, commissions, expenses, exports | clinical data entry |
| BASIC lab users | web app; app safety inbox only | Kiorly Team modules (403 FEATURE_DISABLED) |

## 7. Known limitations and inconsistencies found

* Dev authentication only (no passwords); production uses Passport. Mock providers for messaging, WhatsApp/e-mail delivery, payments.
* The live DB carries e2e leftovers: 248 `demo-lab` orders instead of the roughly 40-50 seeded, 124 home-collection rows, many Kiorex-booking orders. The documented "6 awaiting collection / 3 collected / ..." figures in `Docs/TEST_DATA.md` are therefore lower bounds only.
* `kx_lb_demo_7` is REJECTED in Kiorex and `CANCELLED` in the lab DB (a lab-side cancellation maps to a Kiorex rejection): consistent, but easy to mistake for a seed bug.
* Fixed 21 Nov 2026: all critical alerts used to be ESCALATED by the scheduler, so the "open, not yet escalated" state was missing. `db:seed:demo` now keeps one clearly named alert (`DEMO-OPEN-ALERT-001`) OPEN with a far deadline. Anyone who acknowledges it closes it for good; to re-open it, re-run `db:seed:demo` only while it is still ESCALATED/OPEN (an acknowledged alert is left alone).
* Seeds back-shift order dates with a session-local trigger bypass (needs a superuser role such as the local `postgres`).

## 8. Provider flows in mock mode, and the Provider go-live checklist

**Try every provider flow (mock, DEV ONLY).** As `owner@demo-lab.test` (settings.manage): `POST /api/v1/dev/providers/demo/run` sends result-ready (WhatsApp + email), a critical-alert SMS and an invoice email to dummy recipients (`+201000000001`, `+201000000002`, `patient.demo@example.test`), delivers each receipt through the signed webhook path, then (on the newest unpaid invoice of the org) runs pay-by-link success -> refund and a failing link. `GET /api/v1/dev/providers/messages` is the view of everything "sent" (rendered EN/AR body, status SENT -> DELIVERED); `POST /api/v1/dev/providers/simulate/webhook {"kind":"payment","type":"payment.failed","providerRef":"mocklink_..."}` replays any single callback. All of it is 404 in production. Manual path: invoice a released order -> `POST /invoices/:id/pay-link {"sendVia":{"channel":"SMS"}}` -> simulate `payment.succeeded` -> `POST /pay-links/:id/refund`. Recipients ending `-fail` are rejected by the mock (failure path). Details: [Docs/PROVIDERS.md](Docs/PROVIDERS.md).

### Provider go-live checklist (no code change: env/secrets only; staging first)

Add these to the secrets manager / task definition of the Lab API. Nothing else is needed per kind; the app refuses to start if a real MODE is missing something (it names the variable).

| Kind | Set `*_MODE=real` and | Secrets / values to add | Provider-side to-do |
|---|---|---|---|
| SMS | `SMS_MODE=real` | `SMS_API_URL`, `SMS_API_KEY`, `SMS_WEBHOOK_SECRET`, `SMS_SENDER_ID` | Register the sender id; point delivery receipts at `https://<lab-api>/api/v1/webhooks/providers/sms` |
| Email | `EMAIL_MODE=real` | `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_WEBHOOK_SECRET`, `EMAIL_FROM` | Verify the sending domain (SPF/DKIM); webhook `.../webhooks/providers/email` |
| WhatsApp | `WHATSAPP_MODE=real` | `WHATSAPP_API_URL`, `WHATSAPP_API_KEY`, `WHATSAPP_WEBHOOK_SECRET`, `WHATSAPP_SENDER_ID` | Meta-approved EN + AR templates named exactly like the template ids (`TODO_NEEDS_HUMAN_*`, NH-LB-018); webhook `.../webhooks/providers/whatsapp` |
| Payment | `PAYMENT_MODE=real` | `PAYMENT_API_URL`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | Merchant account; webhook `.../webhooks/providers/payment`; reconcile `PayLink` vs settlement report |
| Push (Kiorly Team) | `PUSH_MODE=real` | `PUSH_API_URL` (Expo: `https://exp.host/--/api/v2/push/send`), optional `PUSH_API_KEY` | Expo project / credentials in the mobile build |
| Storage | `STORAGE_MODE=real` | `STORAGE_API_URL`, `STORAGE_API_KEY` | Private bucket behind an S3-compatible gateway, retention + KMS |

Then: (1) if the vendor's payload or signature differs from the generic shape, edit only `src/providers/mapping/<kind>.mapping.ts`; (2) call `GET /api/v1/dev/providers/status` (non-production) to confirm each kind shows `real` with the credentials set (booleans); (3) send one real message to your own phone and one 1.00 EGP pay link, check `NotificationAttempt` goes SENT -> DELIVERED and the `PayLink` goes PAID; (4) set `PROVIDER_DEV_TOOLS=false` (it is already off when `NODE_ENV=production`). Run `prisma migrate deploy` first (migration `20261122090000_provider_go_live`: `PayLink`, `ProviderWebhookEvent`, `NotificationPurpose.BILLING`).

---
Verified: 2026-11-21 (seed scripts run twice, `kiorly_lab` database via SELECT, web dev port start-up check on 5193).
