# Kiorly Lab test guide (DEV ONLY)

> **DEV ONLY / synthetic.** All names, phones, e-mails, passwords, OTPs and TOTP seeds below are fake values for the local stack; they are refused when `NODE_ENV=production` and the sign-in quick-pick ("Test users (dev only)") is not in production builds. Providers are mocked (dev inbox / logs, PSP `sandbox-fake`, video `mock`). No tax-authority integration.
> This guide is the repo's slice of the workspace guide `TEST_GUIDE.md` (parent folder `kiorex-v2/`, not part of this repository). Facts verified against the seeds and dev databases on 23 Nov 2026.

## Run the stack and seed it

```bash
# from the workspace root (kiorex-v2/): Postgres :5433 + the five APIs (Passport :4400, Kiorly :3010, Kiorex :4000, Pharmacy :3100, Lab :3200)
e2e/scripts/up.sh --build --seed      # first time; later just e2e/scripts/up.sh (stop: e2e/scripts/down.sh)
scripts/seed-all.sh                   # idempotent demo data in dependency order (--reset re-creates demo rows only)
```
One service only: `e2e/scripts/up.sh --restart --only=passport|kiorly|kiorex|pharmacy|lab > /tmp/up.log 2>&1`. Never touch ports 3000 / 5173 / 5175. Tests you run change data (a cancel stays cancelled): re-seed for the starting state.

```bash
cd kiorly-lab
npm run dev -w web                        # Kiorly Lab web :5193 (LAB_WEB_PORT overrides); API :3200
cd apps/api && npm run db:seed && npm run db:seed:demo && npm run db:seed:mobile   # no true reset
cd apps/web && npm run check:dev-test-users
```

URL: http://localhost:5193/login (API http://localhost:3200/api/v1, `POST /auth/dev-login {orgSlug,email}`, AUTH_MODE=dev only).

## The Test users (dev only) panel

Below the login card (`apps/web/src/dev/`, lazy behind `import.meta.env.DEV`; hide with `VITE_DEV_TEST_USERS=false`): all 27 dev-logins (3 labs x 9 roles), one click signs in (no password). The older org picker stays above it. Absent from production builds (`scripts/check-no-dev-test-users.mjs`, also run by `src/dev/dev-test-users.node.test.ts`).

## Test users: 3.5 Kiorly Lab web (:5193, dev-login, no password)

Three labs times nine roles = 27: `demo-lab` (Cairo Diagnostics Lab, Pro, full demo data), `chain-lab` (Delta Diagnostics Group, Enterprise), `basic-lab` (Starter Lab, Lite). Logins are `<role>@<slug>.test` with role in `owner`, `director`, `signatory` (pathologist), `tech`, `phleb`, `reception`, `manager`, `supervisor`, `finance`. All 27 verified.

## Flows

### 4.7 Kiorly Lab (L1-L9)

http://localhost:5193/login.

1. **Reception (`reception@demo-lab.test`).** New order for a registered patient (for example Hala Fouad): CBC plus a lipid panel, routine: order AWAITING_COLLECTION, invoice created, take a cash payment; issue a STAT queue ticket (appears on `/queue-board`).
2. **Phlebotomy (`phleb@`).** `/phleb`: today's home-collection stops; collect a specimen with labels. *Expected:* COLLECTED with a custody event; Validation is not available to this role (7 permissions).
3. **Accession, enter, validate, release.** `tech@`: receive `DEMO-NL3-EDTA`, enter and technically validate results (a delta check may flag); `signatory@`: medically validate and Release. *Expected:* report version, order RELEASED, report in the Kiorex vault, public link `/r/<token>`.
4. **Critical value (`signatory@`).** Open `DEMO-OPEN-ALERT-001` (K 6.9), acknowledge with a note; it closes with who and when; the other alerts are ESCALATED or ACKNOWLEDGED.
5. **QC failure.** The TSH run (rule `1_3s`) is FAIL and the analyte is blocked; `tech@` runs a passing QC, `signatory@` clears the block.
6. **Kiorex lab booking** (workspace guide 4.2 step 11), **merge duplicates** (`supervisor@` or `manager@`: the two `Ahmed Samy` records), **editions** (`director@chain-lab.test` small chain, `director@basic-lab.test` Basic).

7. **Staff phone and Passport sessions (`owner@demo-lab.test`).** Settings > Staff: add a technologist with a phone `+201000003101` (international format; duplicates refused), see the Passport column ("Waiting for first sign-in", then "Linked" after that person signs in with Kiorex Passport). Revoking the web session on the Passport account page ends the Lab web session (back-channel logout, within a minute). Automated: `e2e/test/21-staff-web-session-revocation.e2e.ts`.

More: `DEMO_DATA.md` (L1-L9), `Docs/TEST_DATA.md`.
