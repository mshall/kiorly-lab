# Kiorly Lab — Cursor Build Sequence

> Generated from **KX-07 (Kiorly Lab PRD, Rev 2.2)** and KX-08/KX-09/KX-22/KX-17/KX-18.
> Repo: `mshall/kiorly-lab` · **45 steps** (19 requirement steps, one per PRD requirement ID) in dependency order.
> **Status: MVP built (Nov 2026, engineering pass).** Every code step is implemented and tested; the schema is FROZEN-v1 with NEEDS_HUMAN defaults. Open: the human tasks (discovery, counsel, pathologist sign-offs, pilot) and the commerce-kernel package swap (NH-LB-022). Mock providers only (MODE=mock).
> Each step = one branch, one PR. Do not reorder; every step only depends on earlier steps.

---

## 0. Instructions for Cursor (read this section first, every session)

### 0.1 Execution protocol

1. Open **§5 Progress tracker** and find the **first unchecked step**. That is the only step you work on.
2. Read that step's section in **§6** (`### Step <ID>`). Do not read ahead.
3. Confirm every step listed in **Depends on** is checked. If not, stop and report the missing dependency.
4. Check the step **Type**: *Code* → implement fully. *Code + human input* → implement the code, list the NEEDS_HUMAN items. *Human task* → prepare only, then stop and ask the human.
5. Before changing code read `.cursor/rules/lab.mdc` and §1 below.
6. Implement in order: Prisma migration (new named migration, never edit an applied one) → API module → DTOs/guards → web UI (BOTH en.json and ar.json) → tests → docs.
7. Write a test for **every acceptance criterion**, then run the checks in §0.2.
8. Tick the step in §5 (`- [x]`) with the commit/PR reference; update Docs status rows.
9. Finish with a short summary: what changed, migrations, tests, follow-ups, **Needs human**.

### 0.2 Commands to run before marking a step done

```bash
npm run db:setup       # DB exists + migrations applied (port 5433)
npm run typecheck      # api (prisma generate + tsc) + web
npm run lint           # web
npm test               # api: unit + e2e; web: locale parity
npm run docs:check
```

### 0.3 Hard stops (ask a human, do not invent)

Prices/fees/VAT/refund policy; legal, clinical or consent wording; marking a launch gate satisfied; production credentials, domains, store accounts, PSP onboarding, AWS changes; breaking a published contract. Record each in `Docs/NEEDS_HUMAN.md`.

---

## 1. Repo rules (also in .cursor/rules/lab.mdc)

1. DRAFT schema until LB-D02. 2. No shared DB, no cross-product imports; HMAC REST + outbox. 3. Flags ON by default; OFF => 403 FEATURE_DISABLED. 4. **Safety controls are never flags** (§3). 5. Explicit `@Inject()` in Nest constructors. 6. Money paths: idempotency key + outbox + ledger + reconciliation test. 7. No PHI in logs. 8. 2025 repos are design notes only (ADR-026). 9. Do not touch infra/ or deploy to AWS.

## 2. Phase map and timing (KX-17 / KX-18; discovery interviews first)

| Phase | When | Notes |
|---|---|---|
| Phase 0 — skeleton + plan | now (Nov 2026) | This repo as scaffolded; no features |
| Discovery | before build (M14 lab product lead hire; Q6–Q7 2028) | 15 labs, 2 chains; schema freeze (LB-D02) |
| Build MVP | M15 → M18 | Requirement steps in order; stop-ship suite |
| Pilot | **M19** | 8 labs; zero QC stop-ships |
| GA | **M21** | Kiorex lab bookings + home collection follow (launch-locked flag kiorex.lab_bookings) |

Dates are derived from KX-18 and must be confirmed by the founder; this plan never commits dates externally.

## 3. Safety controls — never flags (ADR-025)

A switch that can disable these is itself a hazard. CI rejects flag keys on safety paths (`apps/api/src/feature-flags/safety-controls.node.test.ts`); the evaluator throws `SafetyControlNotAFlagError`. They exist in **every edition including Lite**. Where possible they are also enforced by database triggers/CHECKs in migration `0001_draft_init`.

| Control id | Rule | Requirements |
|---|---|---|
| `safety.lab.qc_block` | Westgard violation (1-3s, 2-2s, R-4s, 4-1s, 10x) blocks patient release | KLQC02 |
| `safety.lab.authorized_release` | Release requires technical + medical validation and signed report version | KLQC04, KLCRIT02 |
| `safety.lab.critical_value_escalation` | Unacknowledged critical value escalates after configured minutes | KLCRIT01 |
| `safety.lab.accession_uniqueness` | Duplicate accession numbers are rejected | KLSPC01 |
| `safety.lab.custody_append_only` | Chain of custody is append-only | KLSPC03 |
| `safety.lab.label_match` | Mislabelled specimens cannot be processed (label mismatch scan blocks) | KLSPC02, KLSPC04 |
| `safety.lab.audit_logging` | State changes affecting results, access, money are audited | KX-08 §09 |
| `safety.lab.consent_enforcement` | Result release channels require consent | KLORD03, KLCRIT02 |
| `safety.lab.tenant_isolation` | Tenant isolation and authorization | KX-08 §09 |
| `safety.lab.privileged_mfa` | Privileged MFA on production | KX-08 §09 |

Flags that DO exist (ship ON; OFF => 403 FEATURE_DISABLED {key,scope}): `lab.module`, `lab.analyzer_interfaces`, `lab.home_collection`, `lab.kiorex_bookings`.

## 4. Step index

| ID | Type | Title | Depends on |
|---|---|---|---|
| LB-F01 | Code | npm workspaces root, CI, CODEOWNERS, .gitignore, README | none |
| LB-F02 | Code | API skeleton: NestJS 10 + Prisma 6, health live/ready | LB-F01 |
| LB-F03 | Code | Feature-flag evaluator stub reading the Kiorex snapshot (never-flag guard) | LB-F02 |
| LB-F04 | Code | DRAFT Prisma schema + initial migration 0001_draft_init (DB-level safety invariants) | LB-F02 |
| LB-F05 | Code | Web shell: AR/EN, RTL, Kiorly styling, coming-soon page | LB-F01 |
| LB-F06 | Docs | Docs hub: build sequence, NEEDS_HUMAN, design notes, ADR reference | LB-F01 |
| LB-D01 | Human task | Discovery interviews (15 labs, 2 chains) | LB-F06 |
| LB-D02 | Code + human input | Schema freeze review: reconcile the DRAFT schema with discovery findings | LB-D01 |
| LB-F07 (safety) | Code | Kiorex Account OIDC auth, tenant + staff + RBAC, tenant isolation guard | LB-D02 |
| LB-F08 (safety) | Code | Audit log + transactional outbox + HMAC REST client/server (Kiorex) | LB-F07 |
| LB-F09 | Code + human input | Consume @kiorly/commerce-kernel (plans, billing, ledger, settlement) | LB-F07 |
| LB-F10 | Code | Flag snapshot cache + flag.changed webhook receiver + per-flag OFF contract-test harness | LB-F08 |
| LB-F11 | Code | Pin @kiorex/contracts SDK; implement consumed/produced event schemas | LB-F08 |
| KLORD01 | Code + human input | Test catalogue: code, name AR/EN, specimen type, container, volume, fasting/prep instructions, TAT, price. | LB-D02, LB-F07 |
| KLORD02 | Code | Order sources: walk-in, Kiorly Clinic order (CL06), Kiorex booking, referring doctor. | LB-D02, LB-F07, KLORD01, LB-F11 |
| KLORD03 (safety) | Code + human input | Patient identification with two identifiers; consent for result sharing. | LB-D02, LB-F07, KLORD02 |
| KLORD04 | Code + human input | Home collection: slot booking, address, phlebotomist assignment, route, collection confirmation with photo... | LB-D02, LB-F07, KLORD02 |
| KLSPC01 (safety) | Code | Accession number unique per lab; duplicates rejected. | LB-D02, LB-F07, KLORD02 |
| KLSPC02 (safety) | Code + human input | Barcode labels per container; aliquots linked to parent. | LB-D02, LB-F07, KLSPC01 |
| KLSPC03 (safety) | Code | Chain of custody append-only: collected → transported (time, temperature) → received → processed →... | LB-D02, LB-F07, KLSPC01 |
| KLSPC04 | Code + human input | Rejection reasons (haemolysed, insufficient, mislabelled) trigger re-collection workflow and patient notice. | LB-D02, LB-F07, KLSPC03 |
| KLQC01 | Code + human input | Analyzer connectivity via ASTM E1394 / HL7 v2; manual entry with dual control. | LB-D02, LB-F07, KLSPC03 |
| KLQC02 (safety) | Code + human input | Internal QC runs per analyte/level; Levey-Jennings charts; Westgard rules (1₃s, 2₂s, R₄s, 4₁s, 10x) block... | LB-D02, LB-F07, KLQC01 |
| KLQC03 | Code + human input | Reference intervals by age/sex with versioning; delta checks against prior results. | LB-D02, LB-F07, KLQC01 |
| KLQC04 (safety) | Code | Technical validation by technologist; medical validation by authorized signatory. | LB-D02, LB-F07, KLQC02, KLQC03 |
| KLQC05 | Code | Corrected reports create a new version with reason; recipients notified. | LB-D02, LB-F07, KLQC04 |
| KLCRIT01 (safety) | Code + human input | Critical-value list per test; on result, alert ordering clinician and lab director; acknowledgement... | LB-D02, LB-F07, KLQC03 |
| KLCRIT02 (safety) | Code | Release channels: printed report, patient link (OTP), Kiorly Clinic import, Kiorex vault — each by consent. | LB-D02, LB-F07, KLQC04, KLORD03 |
| KLCRIT03 | Code | LabResultReleased event carries signed report version and secure link, never raw values in notifications. | LB-D02, LB-F07, KLCRIT02, LB-F08 |
| KLBIZ01 | Code + human input | Price lists, packages (check-ups), payer contracts, invoices, cash close (reuse commerce kernel). | LB-D02, LB-F07, KLORD01, LB-F09 |
| KLBIZ02 | Code | TAT dashboard and SLA alerts. | LB-D02, LB-F07, KLQC04 |
| KLBIZ03 | Code + human input | Referring-doctor statements (where lawful) and send-out lab costs. | LB-D02, LB-F07, KLBIZ01 |
| LB-OFF01 | Code | OFF contract test for lab.module | LB-F10 |
| LB-OFF02 | Code | OFF contract test for lab.analyzer_interfaces | LB-F10 |
| LB-OFF03 | Code | OFF contract test for lab.home_collection | LB-F10 |
| LB-OFF04 | Code | OFF contract test for lab.kiorex_bookings | LB-F10 |
| LB-SS01 (safety) | Code | Stop-ship: result released without QC pass or signature (QC violation injection) | KLQC02, KLQC04, KLCRIT02 |
| LB-SS02 (safety) | Code | Stop-ship: critical value not acknowledged and not escalated (timer test) | KLCRIT01 |
| LB-SS03 (safety) | Code | Stop-ship: mislabelled sample processed (label mismatch scan test) | KLSPC02, KLSPC03 |
| LB-SS04 (safety) | Code | Stop-ship: duplicate accession accepted (replay test) | KLSPC01 |
| LB-SS05 (safety) | Code | Never-flag CI: QC blocks, authorized release and critical escalation cannot be switched off | KLQC02, KLQC04, KLCRIT01, LB-F10 |
| LB-H01 | Human task | Regulatory review: counsel memo | LB-D01 |
| LB-H02 | Human task | Pathologist sign-off: hazard log (KX-16) | LB-D01 |
| LB-H03 | Human task | Stop-ship suite green on the pilot build (evidence archived) | LB-SS01, LB-SS02, LB-SS03, LB-SS04, LB-SS05 |
| LB-P01 | Human task | Pilot readiness review (8 labs, M19) | LB-H01, LB-H02, LB-H03 |

---

## 5. Progress tracker

- [x] **LB-F01** — npm workspaces root, CI, CODEOWNERS, .gitignore, README (scaffold commit)
- [x] **LB-F02** — API skeleton: NestJS 10 + Prisma 6, health live/ready (scaffold commit)
- [x] **LB-F03** — Feature-flag evaluator stub reading the Kiorex snapshot (never-flag guard) (scaffold commit)
- [x] **LB-F04** — DRAFT Prisma schema + initial migration 0001_draft_init (DB-level safety invariants) (scaffold commit)
- [x] **LB-F05** — Web shell: AR/EN, RTL, Kiorly styling, coming-soon page (scaffold commit)
- [x] **LB-F06** — Docs hub: build sequence, NEEDS_HUMAN, design notes, ADR reference (scaffold commit)
- [ ] **LB-D01** — Discovery interviews (15 labs, 2 chains) — *human task: discovery interviews (NH-LB-001)*
- [x] **LB-D02** — Schema freeze review: reconcile the DRAFT schema with discovery findings — *engineering freeze `0002_freeze_v1` done (db81c06); **human approval NH-LB-023 still open***
- [x] **LB-F07** — Kiorex Account OIDC auth, tenant + staff + RBAC, tenant isolation guard — *OIDC/JWKS + dev auth, RBAC, tenant isolation, privileged MFA (db81c06; tests `tenancy-rbac`)*
- [x] **LB-F08** — Audit log + transactional outbox + HMAC REST client/server (Kiorex) — *audit log + transactional outbox + HMAC (db81c06; tests `integration`, `golden-flow`)*
- [ ] **LB-F09** — Consume @kiorly/commerce-kernel (plans, billing, ledger, settlement) — *BLOCKED on NH-LB-022 (@kiorly/commerce-kernel not published). Seam `src/kernel-adapter/*` + local implementation done; swap providers when published*
- [x] **LB-F10** — Flag snapshot cache + flag.changed webhook receiver + per-flag OFF contract-test harness — *snapshot cache persisted, 30 s poll + ETag, flag.changed webhook, OFF harness (tests `flags-off`, `integration`)*
- [x] **LB-F11** — Pin @kiorex/contracts SDK; implement consumed/produced event schemas — *@kiorex/contracts 1.0.0 pinned; LabResultReleased validated in-transaction + contract tests*
- [x] **KLORD01** — Test catalogue: code, name AR/EN, specimen type, container, volume, fasting/prep instructions, TAT, price. — *catalogue + versioned price book (tests `billing`, `tenancy-rbac`)*
- [x] **KLORD02** — Order sources: walk-in, Kiorly Clinic order (CL06), Kiorex booking, referring doctor, Kiorly Nurse visit (KLORD05). — *walk-in, Kiorly Clinic handoff, Kiorex booking, referring doctor; idempotent (tests `integration`); **Rev 2.3:** `KIORLY_NURSE` source (tests `nurse-samples`)*
- [x] **KLORD03** — Patient identification with two identifiers; consent for result sharing. — *two identifiers + per-channel consent (tests `safety-stop-ship`, `analysis`)*
- [x] **KLORD04** — Home collection: slot booking inside coverage zones, address, phlebotomist assignment, travel buffers, route, on-my-way/arrived/finished geostamps, label photo — using @kiorly/field-visit; phlebotomists get the safety timer, SOS and unsafe-abort (never switchable). — *slots with capacity, assignment, route, label photo, offline PWA (tests `home-collection`); **Rev 2.3:** `@kiorly/field-visit` 0.1.0 (vendored tarball) lifecycle, coverage `OUT_OF_COVERAGE`, 30/30 buffers + daily cap (`canBook`), address masking (BR52), safety timer/SOS/unsafe-abort BR61 (tests `home-safety`, `Docs/FIELD_VISIT.md`)*
- [x] **KLORD05** — Nurse-collected samples: a Kiorly Nurse visit records a lab order and sample collection; the lab accessions it with chain of custody starting at the nurse's collection time (consent required). Also KNLAB01. — *`POST /integration/v1/orders` with `nurseCollection` from a `KIORLY_NURSE` client, mapped from `LabOrderPlaced` (kiorex-contracts 1.6.0, ratified fields); custody from collection time, label-scan receipt, nurse custody view (tests `nurse-samples`, `Docs/NURSE_SAMPLES.md`)*
- [x] **KLSPC01** — Accession number unique per lab; duplicates rejected. — *per-lab daily sequence + DB unique (LB-SS04)*
- [x] **KLSPC02** — Barcode labels per container; aliquots linked to parent. — *Code 128 labels + ZPL, aliquots (unit + e2e)*
- [x] **KLSPC03** — Chain of custody append-only: collected → transported (time, temperature) → received → processed →... — *append-only custody (DB trigger) with time/temperature*
- [x] **KLSPC04** — Rejection reasons (haemolysed, insufficient, mislabelled) trigger re-collection workflow and patient notice. — *rejection reasons -> re-collection specimen + mock WhatsApp notice (template TODO_NEEDS_HUMAN)*
- [x] **KLQC01** — Analyzer connectivity via ASTM E1394 / HL7 v2; manual entry with dual control. — *simulated ASTM E1394 / HL7 v2 analyzer bridge + parsers w/ fixtures; manual dual control; auto-verification (tests `analysis`, parsers)*
- [x] **KLQC02** — Internal QC runs per analyte/level; Levey-Jennings charts; Westgard rules (1₃s, 2₂s, R₄s, 4₁s, 10x) block... — *Westgard 1-3s/2-2s/R-4s/4-1s/10x + LJ charts + QC blocks (property-based tests)*
- [x] **KLQC03** — Reference intervals by age/sex with versioning; delta checks against prior results. — *versioned age/sex intervals + delta check*
- [x] **KLQC04** — Technical validation by technologist; medical validation by authorized signatory. — *technical + medical validation; authorised signatory with licence*
- [x] **KLQC05** — Corrected reports create a new version with reason; recipients notified. — *corrections create new signed version with reason; recipients notified*
- [x] **KLCRIT01** — Critical-value list per test; on result, alert ordering clinician and lab director; acknowledgement... — *critical rules, alerts, ack window, escalation timer (LB-SS02)*
- [x] **KLCRIT02** — Release channels: printed report, patient link (OTP), Kiorly Clinic import, Kiorly Nurse import (nurse-ordered samples), Kiorex vault — each by consent. — *printed / patient OTP link / clinic import / Kiorex vault, each by consent; **Rev 2.3:** `KIORLY_NURSE_IMPORT` (contract channel `KIORLY_CLINIC`; tests `nurse-samples`)*
- [x] **KLCRIT03** — LabResultReleased event carries signed report version and secure link, never raw values in notifications. — *LabResultReleased with signed version + secure link, never raw values*
- [x] **KLBIZ01** — Price lists, packages (check-ups), payer contracts, invoices, cash close (reuse commerce kernel). — *price lists, packages, B2B payer contracts, invoices (VAT lines only), mock-PSP payments, cash close, ledger reconciliation; kernel package swap pending (NH-LB-022)*
- [x] **KLBIZ02** — TAT dashboard and SLA alerts. — *TAT dashboard + deduplicated SLA alerts*
- [x] **KLBIZ03** — Referring-doctor statements (where lawful) and send-out lab costs. — *referring-doctor statements (disabled until counsel confirms, NH-LB-003) + send-out costs*
- [x] **LB-OFF01** — OFF contract test for lab.module — *`flags-off.e2e.test.ts`*
- [x] **LB-OFF02** — OFF contract test for lab.analyzer_interfaces — *`flags-off.e2e.test.ts`*
- [x] **LB-OFF03** — OFF contract test for lab.home_collection — *`flags-off.e2e.test.ts`*
- [x] **LB-OFF04** — OFF contract test for lab.kiorex_bookings — *`flags-off.e2e.test.ts`*
- [x] **LB-SS01** — Stop-ship: result released without QC pass or signature (QC violation injection) — *`safety-stop-ship.e2e.test.ts`*
- [x] **LB-SS02** — Stop-ship: critical value not acknowledged and not escalated (timer test) — *`safety-stop-ship.e2e.test.ts`*
- [x] **LB-SS03** — Stop-ship: mislabelled sample processed (label mismatch scan test) — *`safety-stop-ship.e2e.test.ts`*
- [x] **LB-SS04** — Stop-ship: duplicate accession accepted (replay test) — *`safety-stop-ship.e2e.test.ts`*
- [x] **LB-SS06** — Stop-ship (Rev 2.3): phlebotomist safety: timer prompt/alert within 60 s, SOS with live location, unsafe-abort never a no-show, safety never switchable (flag OFF / plan downgrade / env) — *`home-safety.e2e.test.ts` (+ `@kiorly/field-visit` drill suite)*
- [x] **LB-SS05** — Never-flag CI: QC blocks, authorized release and critical escalation cannot be switched off — *`flags-off.e2e.test.ts` (all flags OFF, safety chain still works)*
- [ ] **LB-H01** — Regulatory review: counsel memo — *human task (NH-LB-014, NH-LB-024)*
- [ ] **LB-H02** — Pathologist sign-off: hazard log (KX-16) — *human task (NH-LB-015)*
- [ ] **LB-H03** — Stop-ship suite green on the pilot build (evidence archived) — *stop-ship suite is green in this build; human archiving of evidence on the pilot build still open*
- [ ] **LB-P01** — Pilot readiness review (8 labs, M19) — *human task (NH-LB-020)*

---

## 6. Step details

### Step LB-F01 — npm workspaces root, CI, CODEOWNERS, .gitignore, README

- **Type:** Code
- **Depends on:** none
- **Acceptance criteria (each needs a test):**
  - Workspace installs; CI workflow runs typecheck + tests.

### Step LB-F02 — API skeleton: NestJS 10 + Prisma 6, health live/ready

- **Type:** Code
- **Depends on:** LB-F01
- **Acceptance criteria (each needs a test):**
  - GET /api/v1/health/live and /ready return 200 (health e2e test).

### Step LB-F03 — Feature-flag evaluator stub reading the Kiorex snapshot (never-flag guard)

- **Type:** Code
- **Depends on:** LB-F02
- **Acceptance criteria (each needs a test):**
  - Defaults ON / launch-locked OFF with no snapshot; safety keys throw (unit tests).

### Step LB-F04 — DRAFT Prisma schema + initial migration 0001_draft_init (DB-level safety invariants)

- **Type:** Code
- **Depends on:** LB-F02
- **Acceptance criteria (each needs a test):**
  - Schema smoke test exercises triggers/CHECKs against the real DB.

### Step LB-F05 — Web shell: AR/EN, RTL, Kiorly styling, coming-soon page

- **Type:** Code
- **Depends on:** LB-F01
- **Acceptance criteria (each needs a test):**
  - Locale parity test; page renders and switches direction.

### Step LB-F06 — Docs hub: build sequence, NEEDS_HUMAN, design notes, ADR reference

- **Type:** Docs
- **Depends on:** LB-F01
- **Acceptance criteria (each needs a test):**
  - npm run docs:check passes.

### Step LB-D01 — Discovery interviews (15 labs, 2 chains)

- **Type:** Human task
- **Depends on:** LB-F06
- **Needs human:** NH-LB-001
- **Acceptance criteria (each needs a test):**
  - Synthesis memo filed in Docs/; recommendations on editions, workflows and the draft schema.

### Step LB-D02 — Schema freeze review: reconcile the DRAFT schema with discovery findings

- **Type:** Code + human input
- **Depends on:** LB-D01
- **Needs human:** NH-LB-023
- **Acceptance criteria (each needs a test):**
  - Schema reviewed entity by entity; follow-up migration 0002 lands; banner changed from DRAFT to FROZEN-v1; schema smoke test updated.

### Step LB-F07 — Kiorex Account OIDC auth, tenant + staff + RBAC, tenant isolation guard

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-D02
- **Acceptance criteria (each needs a test):**
  - JWT (aud/iss) validated; every query is orgId-scoped (cross-tenant access test).
  - Privileged roles require MFA claim in production.
  - Tenant isolation is not flag-controlled.

### Step LB-F08 — Audit log + transactional outbox + HMAC REST client/server (Kiorex)

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-F07
- **Acceptance criteria (each needs a test):**
  - State changes write AuditLog; events written to OutboxEvent in the same transaction.
  - Outbox sender signs webhooks with HMAC; Kiorex de-duplicates on eventId (contract test).

### Step LB-F09 — Consume @kiorly/commerce-kernel (plans, billing, ledger, settlement)

- **Type:** Code + human input
- **Depends on:** LB-F07
- **Needs human:** NH-LB-022
- **Acceptance criteria (each needs a test):**
  - Kernel package installed from GitHub Packages (ADR-027); money path has idempotency key, outbox event, ledger entry, reconciliation test.

### Step LB-F10 — Flag snapshot cache + flag.changed webhook receiver + per-flag OFF contract-test harness

- **Type:** Code
- **Depends on:** LB-F08
- **Needs human:** NH-LB-016
- **Acceptance criteria (each needs a test):**
  - Snapshot persisted in FlagSnapshotCache and survives restart; 30 s poll with If-None-Match; webhook HMAC verified and refreshes immediately.
  - OFF => 403 FEATURE_DISABLED {key,scope}; never hides data.

### Step LB-F11 — Pin @kiorex/contracts SDK; implement consumed/produced event schemas

- **Type:** Code
- **Depends on:** LB-F08
- **Acceptance criteria (each needs a test):**
  - LabResultReleased and the inbound order shapes validate against kiorex-contracts schemas in contract tests.

### Step KLORD01 — Test catalogue: code, name AR/EN, specimen type, container, volume, fasting/prep instructions, TAT, price.

- **Type:** Code + human input
- **Depends on:** LB-D02, LB-F07
- **Source:** KX-07 KLORD01 (Orders & collection): Test catalogue: code, name AR/EN, specimen type, container, volume, fasting/prep instructions, TAT, price.
- **Module:** apps/api/src/modules/orders
- **Schema (draft):** TestDefinition, Analyte, TestAnalyte, TestPackage
- **Needs human:** NH-LB-009 (starter test catalogue content and TAT defaults)
- **Acceptance criteria (each needs a test):**
  - Catalogue holds code, AR/EN names, specimen type, container, volume, fasting/prep, TAT and price.
  - Code is unique per tenant; price changes are versioned (kernel price book).

### Step KLORD02 — Order sources: walk-in, Kiorly Clinic order (CL06), Kiorex booking, referring doctor.

- **Type:** Code
- **Depends on:** LB-D02, LB-F07, KLORD01, LB-F11
- **Source:** KX-07 KLORD02 (Orders & collection): Order sources: walk-in, Kiorly Clinic order (CL06), Kiorex booking, referring doctor.
- **Module:** apps/api/src/modules/orders
- **Schema (draft):** LabOrder, OrderItem
- **Acceptance criteria (each needs a test):**
  - Walk-in, Kiorly Clinic (CL06), Kiorex booking and referring-doctor sources create orders.
  - External orders are idempotent on (orgId, source, sourceRef).

### Step KLORD03 — Patient identification with two identifiers; consent for result sharing.

- **Type:** Code + human input · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-D02, LB-F07, KLORD02
- **Source:** KX-07 KLORD03 (Orders & collection): Patient identification with two identifiers; consent for result sharing.
- **Module:** apps/api/src/modules/orders
- **Schema (draft):** PatientRef, LabOrder
- **Needs human:** NH-LB-007 (result-sharing consent wording AR/EN)
- **Acceptance criteria (each needs a test):**
  - Registration requires two identifiers; verification is recorded.
  - Result sharing consent per channel is captured; releases check it (never a flag).

### Step KLORD04 — Home collection: slot booking, address, phlebotomist assignment, route, collection confirmation with photo...

- **Type:** Code + human input
- **Depends on:** LB-D02, LB-F07, KLORD02
- **Source:** KX-07 KLORD04 (Orders & collection): Home collection: slot booking, address, phlebotomist assignment, route, collection confirmation with photo of labels.
- **Module:** apps/api/src/modules/orders
- **Schema (draft):** HomeCollection
- **Flag:** `lab.home_collection` (ships ON; OFF contract test required)
- **Needs human:** NH-LB-011 (phlebotomist app policy, label-photo privacy)
- **Acceptance criteria (each needs a test):**
  - Slot booking, address, phlebotomist assignment, route and collection confirmation with label photo.
  - OFF behaviour: walk-in collection only (per-flag OFF contract test).

### Step KLSPC01 — Accession number unique per lab; duplicates rejected.

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-D02, LB-F07, KLORD02
- **Source:** KX-07 KLSPC01 (Specimens): Accession number unique per lab; duplicates rejected.
- **Module:** apps/api/src/modules/specimens
- **Schema (draft):** Specimen
- **Acceptance criteria (each needs a test):**
  - Accession is unique per lab; duplicates rejected (DB unique + service).
  - Stop-ship test LB-SS04 (replay) passes.

### Step KLSPC02 — Barcode labels per container; aliquots linked to parent.

- **Type:** Code + human input · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-D02, LB-F07, KLSPC01
- **Source:** KX-07 KLSPC02 (Specimens): Barcode labels per container; aliquots linked to parent.
- **Module:** apps/api/src/modules/specimens
- **Schema (draft):** Specimen
- **Needs human:** NH-LB-012 (label printer and barcode symbology)
- **Acceptance criteria (each needs a test):**
  - Labels per container; aliquots link to parent.
  - A scan that does not match the expected barcode blocks processing and logs LABEL_MISMATCH_BLOCKED (stop-ship LB-SS03).

### Step KLSPC03 — Chain of custody append-only: collected → transported (time, temperature) → received → processed →...

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-D02, LB-F07, KLSPC01
- **Source:** KX-07 KLSPC03 (Specimens): Chain of custody append-only: collected → transported (time, temperature) → received → processed → stored/disposed.
- **Module:** apps/api/src/modules/specimens
- **Schema (draft):** CustodyEvent
- **Acceptance criteria (each needs a test):**
  - collected, transported (time, temperature), received, processed, stored/disposed events append only.
  - UPDATE/DELETE on custody rows is rejected by the database.

### Step KLSPC04 — Rejection reasons (haemolysed, insufficient, mislabelled) trigger re-collection workflow and patient notice.

- **Type:** Code + human input
- **Depends on:** LB-D02, LB-F07, KLSPC03
- **Source:** KX-07 KLSPC04 (Specimens): Rejection reasons (haemolysed, insufficient, mislabelled) trigger re-collection workflow and patient notice.
- **Module:** apps/api/src/modules/specimens
- **Schema (draft):** Specimen, CustodyEvent
- **Needs human:** NH-LB-008 (patient notice wording AR/EN; WhatsApp template)
- **Acceptance criteria (each needs a test):**
  - Rejection requires a reason and triggers re-collection workflow and patient notice.

### Step KLQC01 — Analyzer connectivity via ASTM E1394 / HL7 v2; manual entry with dual control.

- **Type:** Code + human input
- **Depends on:** LB-D02, LB-F07, KLSPC03
- **Source:** KX-07 KLQC01 (Analysis & QC): Analyzer connectivity via ASTM E1394 / HL7 v2; manual entry with dual control.
- **Module:** apps/api/src/modules/analysis-qc
- **Schema (draft):** Result, Instrument
- **Flag:** `lab.analyzer_interfaces` (ships ON; OFF contract test required)
- **Needs human:** NH-LB-010 (first two analyzer models, ASTM/HL7 test access)
- **Acceptance criteria (each needs a test):**
  - ASTM E1394 and HL7 v2 messages map to Result rows (fixture-driven).
  - Manual entry requires a second user (dual control) when analyzers are OFF.
  - OFF behaviour: manual entry with dual control.

### Step KLQC02 — Internal QC runs per analyte/level; Levey-Jennings charts; Westgard rules (1₃s, 2₂s, R₄s, 4₁s, 10x) block...

- **Type:** Code + human input · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-D02, LB-F07, KLQC01
- **Source:** KX-07 KLQC02 (Analysis & QC): Internal QC runs per analyte/level; Levey-Jennings charts; Westgard rules (1₃s, 2₂s, R₄s, 4₁s, 10x) block patient release on violation.
- **Module:** apps/api/src/modules/analysis-qc
- **Schema (draft):** QcRun, QcMaterialLevel, QcBlock
- **Needs human:** NH-LB-005 (Westgard rule set and limits sign-off by pathologist)
- **Acceptance criteria (each needs a test):**
  - 1-3s, 2-2s, R-4s, 4-1s and 10x violations produce a FAIL run and open a QcBlock.
  - Patient release is blocked while a FAIL covers the result or a block is open (service AND DB trigger).
  - Stop-ship test LB-SS01 (QC violation injection) passes.

### Step KLQC03 — Reference intervals by age/sex with versioning; delta checks against prior results.

- **Type:** Code + human input
- **Depends on:** LB-D02, LB-F07, KLQC01
- **Source:** KX-07 KLQC03 (Analysis & QC): Reference intervals by age/sex with versioning; delta checks against prior results.
- **Module:** apps/api/src/modules/analysis-qc
- **Schema (draft):** ReferenceInterval, Result
- **Needs human:** NH-LB-013 (reference interval source and licence)
- **Acceptance criteria (each needs a test):**
  - Intervals are versioned by age/sex; results store the interval version used.
  - Delta check against the prior result flags large changes for review.

### Step KLQC04 — Technical validation by technologist; medical validation by authorized signatory.

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-D02, LB-F07, KLQC02, KLQC03
- **Source:** KX-07 KLQC04 (Analysis & QC): Technical validation by technologist; medical validation by authorized signatory.
- **Module:** apps/api/src/modules/analysis-qc
- **Schema (draft):** Result, StaffUser
- **Acceptance criteria (each needs a test):**
  - Technical validation by a technologist and medical validation by an authorized signatory are separate, attributed steps.
  - A released result without medical validation and QC reference is impossible (DB CHECK).

### Step KLQC05 — Corrected reports create a new version with reason; recipients notified.

- **Type:** Code
- **Depends on:** LB-D02, LB-F07, KLQC04
- **Source:** KX-07 KLQC05 (Analysis & QC): Corrected reports create a new version with reason; recipients notified.
- **Module:** apps/api/src/modules/analysis-qc
- **Schema (draft):** ReportVersion
- **Acceptance criteria (each needs a test):**
  - A correction creates version n+1 with a mandatory reason and supersedes the prior version.
  - Recipients of earlier versions are notified (outbox).

### Step KLCRIT01 — Critical-value list per test; on result, alert ordering clinician and lab director; acknowledgement...

- **Type:** Code + human input · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-D02, LB-F07, KLQC03
- **Source:** KX-07 KLCRIT01 (Release & critical values): Critical-value list per test; on result, alert ordering clinician and lab director; acknowledgement required within configured minutes or escalate.
- **Module:** apps/api/src/modules/release
- **Schema (draft):** CriticalRule, CriticalAlert
- **Needs human:** NH-LB-006 (critical value list and ack minutes per test, pathologist)
- **Acceptance criteria (each needs a test):**
  - A critical result alerts the ordering clinician and lab director.
  - Unacknowledged alerts escalate after the configured minutes (timer test LB-SS02).
  - Escalation cannot be disabled by any flag.

### Step KLCRIT02 — Release channels: printed report, patient link (OTP), Kiorly Clinic import, Kiorex vault — each by consent.

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** LB-D02, LB-F07, KLQC04, KLORD03
- **Source:** KX-07 KLCRIT02 (Release & critical values): Release channels: printed report, patient link (OTP), Kiorly Clinic import, Kiorex vault — each by consent.
- **Module:** apps/api/src/modules/release
- **Schema (draft):** ReleaseRecord, ReportVersion
- **Acceptance criteria (each needs a test):**
  - Each release channel (print, patient link with OTP, Kiorly Clinic import, Kiorex vault) is consent-checked.
  - A release always references a signed ReportVersion (NOT NULL FK).

### Step KLCRIT03 — LabResultReleased event carries signed report version and secure link, never raw values in notifications.

- **Type:** Code
- **Depends on:** LB-D02, LB-F07, KLCRIT02, LB-F08
- **Source:** KX-07 KLCRIT03 (Release & critical values): LabResultReleased event carries signed report version and secure link, never raw values in notifications.
- **Module:** apps/api/src/modules/release
- **Schema (draft):** OutboxEvent
- **Acceptance criteria (each needs a test):**
  - LabResultReleased carries signed report version and secure link only; contract test asserts no raw values in the payload or notification body.

### Step KLBIZ01 — Price lists, packages (check-ups), payer contracts, invoices, cash close (reuse commerce kernel).

- **Type:** Code + human input
- **Depends on:** LB-D02, LB-F07, KLORD01, LB-F09
- **Source:** KX-07 KLBIZ01 (Business): Price lists, packages (check-ups), payer contracts, invoices, cash close (reuse commerce kernel).
- **Module:** apps/api/src/modules/business
- **Schema (draft):** TestPackage, OrderItem
- **Needs human:** NH-LB-004 (pricing; PRD gives no price points)
- **Acceptance criteria (each needs a test):**
  - Price lists, packages and payer contracts feed invoices through the commerce kernel.
  - Cash close reconciles to the ledger.

### Step KLBIZ02 — TAT dashboard and SLA alerts.

- **Type:** Code
- **Depends on:** LB-D02, LB-F07, KLQC04
- **Source:** KX-07 KLBIZ02 (Business): TAT dashboard and SLA alerts.
- **Module:** apps/api/src/modules/business
- **Schema (draft):** LabOrder
- **Acceptance criteria (each needs a test):**
  - TAT dashboard computes order-to-release minutes vs TestDefinition.tatMinutes.
  - SLA breach alerts are queued once per order.

### Step KLBIZ03 — Referring-doctor statements (where lawful) and send-out lab costs.

- **Type:** Code + human input
- **Depends on:** LB-D02, LB-F07, KLBIZ01
- **Source:** KX-07 KLBIZ03 (Business): Referring-doctor statements (where lawful) and send-out lab costs.
- **Module:** apps/api/src/modules/business
- **Schema (draft):** LabOrder
- **Needs human:** NH-LB-003 (counsel: referring-doctor statements where lawful)
- **Acceptance criteria (each needs a test):**
  - Statements and send-out lab costs are produced only for tenants where the legal flag is set by a human.

### Step LB-OFF01 — OFF contract test for lab.module

- **Type:** Code
- **Depends on:** LB-F10
- **Acceptance criteria (each needs a test):**
  - With lab.module OFF: No new sign-ups; existing tenants read-only with export. Responses are 403 FEATURE_DISABLED {key,scope}; no data is hidden; export still works.

### Step LB-OFF02 — OFF contract test for lab.analyzer_interfaces

- **Type:** Code
- **Depends on:** LB-F10
- **Acceptance criteria (each needs a test):**
  - With lab.analyzer_interfaces OFF: Manual entry with dual control. Responses are 403 FEATURE_DISABLED {key,scope}; no data is hidden; export still works.

### Step LB-OFF03 — OFF contract test for lab.home_collection

- **Type:** Code
- **Depends on:** LB-F10
- **Acceptance criteria (each needs a test):**
  - With lab.home_collection OFF: Walk-in collection only. Responses are 403 FEATURE_DISABLED {key,scope}; no data is hidden; export still works.

### Step LB-OFF04 — OFF contract test for lab.kiorex_bookings

- **Type:** Code
- **Depends on:** LB-F10
- **Acceptance criteria (each needs a test):**
  - With lab.kiorex_bookings OFF: Not bookable from Kiorex. Responses are 403 FEATURE_DISABLED {key,scope}; no data is hidden; export still works.

### Step LB-SS01 — Stop-ship: result released without QC pass or signature (QC violation injection)

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** KLQC02, KLQC04, KLCRIT02
- **Acceptance criteria (each needs a test):**
  - Injecting each Westgard violation blocks release; release without signature is impossible at API and DB.

### Step LB-SS02 — Stop-ship: critical value not acknowledged and not escalated (timer test)

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** KLCRIT01
- **Acceptance criteria (each needs a test):**
  - Advancing the clock past ackWithinMinutes escalates exactly once and records who was notified.

### Step LB-SS03 — Stop-ship: mislabelled sample processed (label mismatch scan test)

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** KLSPC02, KLSPC03
- **Acceptance criteria (each needs a test):**
  - A mismatching scan blocks processing, appends LABEL_MISMATCH_BLOCKED and notifies the supervisor.

### Step LB-SS04 — Stop-ship: duplicate accession accepted (replay test)

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** KLSPC01
- **Acceptance criteria (each needs a test):**
  - Replaying an accession request returns the original or is rejected; never creates a second row.

### Step LB-SS05 — Never-flag CI: QC blocks, authorized release and critical escalation cannot be switched off

- **Type:** Code · **SAFETY PATH (ADR-025, never a flag)**
- **Depends on:** KLQC02, KLQC04, KLCRIT01, LB-F10
- **Acceptance criteria (each needs a test):**
  - Static test rejects flag usage on safety paths; with every flag OFF all blocks still enforce.

### Step LB-H01 — Regulatory review: counsel memo

- **Type:** Human task
- **Depends on:** LB-D01
- **Needs human:** NH-LB-014
- **Acceptance criteria (each needs a test):**
  - Memo on lab software, result release/sharing, home collection and online test bookings filed; Kiorex-side launch-locked flag kiorex.lab_bookings gate evidence recorded by a human.

### Step LB-H02 — Pathologist sign-off: hazard log (KX-16)

- **Type:** Human task
- **Depends on:** LB-D01
- **Needs human:** NH-LB-015
- **Acceptance criteria (each needs a test):**
  - Hazard log reviewed and signed; each hazard maps to a safety control and a stop-ship test.

### Step LB-H03 — Stop-ship suite green on the pilot build (evidence archived)

- **Type:** Human task
- **Depends on:** LB-SS01, LB-SS02, LB-SS03, LB-SS04, LB-SS05
- **Acceptance criteria (each needs a test):**
  - Founder/QA records the CI run id; marking a launch gate satisfied is a human action only.

### Step LB-P01 — Pilot readiness review (8 labs, M19)

- **Type:** Human task
- **Depends on:** LB-H01, LB-H02, LB-H03
- **Needs human:** NH-LB-020
- **Acceptance criteria (each needs a test):**
  - All STOP items in NEEDS_HUMAN closed; pilot cohort named; support rota agreed.
