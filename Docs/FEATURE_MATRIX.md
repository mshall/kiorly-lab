# Feature matrix: standalone LIS checklist

Status key: **Done** = implemented end to end (API + web + tests + seed data) and exercised by an automated test · **Done (mock)** = the provider side is a mock adapter by founder decision (`MODE=mock`), the code path is real · **Not possible** = could not be built, with the reason.
API = `apps/api/src/modules/...`, web = `apps/web/src/features/...`, tests in `apps/api/test/*.e2e.test.ts` (integration, real DB) and `apps/api/src/**/*.node.test.ts` (unit). Counts at the last run: API unit 105 + API e2e 143 + web 6 + Playwright 2 specs.

## 1. Patients, referrers
| Item | Status | Files | Tests |
|---|---|---|---|
| Patient registry independent of Kiorly (demographics, national ID hashed, MRN, search) | Done | `registry/patient-registry.service.ts`, `orders/patients.service.ts`; web `patients/PatientsPage.tsx` | `registry.e2e` (create/search/update/audit, same national ID = same person) |
| History of results + cumulative trend per analyte with charts | Done | `patient-registry.service.ts` (`history`, `trends`), `registry/cumulative-pdf.ts`; web `PatientProfilePage.tsx`, `components/charts.tsx` | `registry.e2e` (trend/delta), `reporting.e2e` (cumulative PDF) |
| Merge duplicates | Done | `registry/duplicates.ts`, `merge()` | `duplicates.node.test`, `registry.e2e` (detect, merge, hidden source, audit) |
| Consent (append-only history per kind) | Done | `PatientConsent` + DB trigger; `addConsent` | `registry.e2e` |
| Referring doctors/clinics directory | Done | `registry/referrers.service.ts`; web `ReferrersPage.tsx` | `registry.e2e` |
| Result delivery preferences per referrer (auto-send on release) | Done (mock) | `referrers.service`, `release/delivery.service.ts` (`autoDeliverToReferrer`) | `reporting.e2e` (auto-delivery, consent gate) |
| Commission and credit accounts (accrual on invoice, reversal on void, payout, credit limit) | Done | `referrers.service` (append-only `ReferrerLedgerEntry`), `business/billing.service.ts` hook | `registry.e2e` |
| Doctor portal | Done | `referrers.service` portal methods, `registry.controller` public routes; web `portal/DoctorPortalPage.tsx` | `registry.e2e` (consent + release gate, revoke) |

## 2. Order entry
| Item | Status | Files | Tests |
|---|---|---|---|
| Walk-in / referred / home / package / STAT / fasting | Done (existing + extended) | `orders/*`, `reception/*`; web `NewOrderPage.tsx` | `golden-flow`, `home-collection`, `reception.e2e` |
| Clinical info + ICD-10 hints (suggested tests) | Done | `reception/icd.ts`, `LabOrder.clinicalInfo/icdCodes` | `slots.node.test`, `reception.e2e` |
| Order edit / add-remove tests / cancel with audit and revisions | Done | `reception/order-edit.service.ts`, `OrderRevision`, `orders.service.cancel`; web `OrderExtras.tsx` | `reception.e2e` (revisions, invoice lock, no PHI in audit) |
| Barcode / label printing 1D and 2D (Code 128, QR, ZPL) | Done | `specimens/qr.ts`, `specimens.service.label/orderLabels` | `qr.node.test` (decoded by Apple's Vision QR detector during development), `reception.e2e` |
| Appointments / collection slots with capacity | Done | `reception/appointments.service.ts`, `slots.ts`; web `ReceptionPage.tsx` | `slots.node.test`, `reception.e2e` |
| Queue / token display for reception | Done | `reception/queue.service.ts`; web `ReceptionPage.tsx`, `QueueBoardPage.tsx` | `reception.e2e` (STAT lane, state machine, names hidden on the board) |

## 3. Pre-analytics
| Item | Status | Files | Tests |
|---|---|---|---|
| Accessioning, custody | Done (existing) | `specimens/*` | `golden-flow`, `specimens.node.test` |
| Rejection with reasons, recollection requests | Done | `specimens.service.reject`, `preanalytics/recollections.service.ts`; 5 new reasons | `preanalytics.e2e` |
| Aliquoting / splitting by volume | Done | `specimens.service.aliquot` (`volumeMl`) | `preanalytics.e2e` |
| Storage racks/freezers location tracking | Done | `preanalytics/storage.service.ts`, `storage-grid.ts` (unique active slot index); web `StoragePage.tsx` | `storage-grid.node.test`, `preanalytics.e2e` |
| Retention and disposal | Done | `RetentionRule`, `disposalDue`, `disposeBulk` | `preanalytics.e2e` |
| Transport manifests (branches / send-outs) and courier tracking | Done | `preanalytics/manifests.service.ts`, public `/public/track/:ref` | `preanalytics.e2e` |

## 4. Analytics
| Item | Status | Files | Tests |
|---|---|---|---|
| Worklists by section / instrument / priority | Done | `results.service.worklist`, `Instrument.sections`, `TestDefinition.section`; web `WorklistPage.tsx` | `analytics.e2e` |
| Manual + instrument entry, analyzer interface (HL7/ASTM + simulator) | Done (existing) | `analyzers/*` | `parsers.node.test`, `analysis.e2e` |
| Calculated / derived tests (formula language, QC inherited from inputs) | Done | `analysis-qc/formula.ts`, `results.service.recomputeDerived`, `qc-gate.ts` | `formula.node.test`, `analytics.e2e` (LDL, eGFR, QC block on an input) |
| Reference ranges by age / sex / condition | Done | `pickInterval(... conditions)`, `ReferenceInterval.condition`, `PatientRef.conditions` | `common.node.test`, `analytics.e2e` (pregnancy TSH) |
| Delta checks (percent, absolute, look-back window) and auto-verification | Done | `results.service.persistIn`, `AutoVerificationRule` | `analytics.e2e`, `analysis.e2e` |
| Repeat / rerun and dilution | Done | `results.service.rerun`, `RerunRequest` | `analytics.e2e` |
| Multi-component panels | Done | `TestAnalyte`; 28 panels in the seed | `analytics.e2e`, seed |
| Microbiology (culture and sensitivity, organisms, panels, selective reporting, critical positive blood culture) | Done | `microbiology/*`; web `MicrobiologyPage.tsx` | `summary.node.test`, `analytics.e2e` |
| Histopathology / cytology basic reporting (grossing, reporting, sign-out, addenda) | Done | `histopathology/*` | `histopathology.node.test`, `analytics.e2e` |
| Semi-quantitative and text results | Done | `Analyte.valueType/allowedValues/normalValues` | `analytics.e2e` |
| Amendments / corrected reports with versions | Done | `results.service.correct/amendments`, `reports.service.sign` | `analytics.e2e`, `analysis.e2e` |

## 5. QC and quality
| Item | Status | Files | Tests |
|---|---|---|---|
| Levey-Jennings, Westgard rules | Done (existing) | `analysis-qc/westgard.ts`; web `LeveyJenningsChart.tsx` | `westgard.node.test`, `analysis.e2e` |
| QC lot management (expiry, retire, statistics) | Done | `quality/quality.service` (`lots`, `statistics`), `qc.service` (retired lots refuse runs) | `quality-math.node.test`, `quality.e2e` |
| Calibration records | Done | `calibrate` (failed -> NCR) | `quality.e2e` |
| Proficiency testing / EQA (z-score, unacceptable -> NCR) | Done | `recordEqa`, `quality-math.ts` | `quality.e2e` |
| Instrument maintenance schedule + logs | Done | `createSchedule`, `logMaintenance` | `quality.e2e` |
| Non-conformance / CAPA | Done | `raiseNcr`, `advanceNcr`, `addCapa`, `verifyCapa` (verifier differs from owner) | `quality.e2e` |
| Document control (light) and SOP library with acknowledgements | Done | `createDocument`, version workflow (author cannot approve), `acknowledge` | `quality.e2e` |
| Audit trail and viewer | Done | `AuditLog` (append-only), `GET /audit-logs` filters; web `SettingsExtras.tsx` `AuditViewer` | `tenancy-rbac.e2e`, `admin-analytics.e2e` |

## 6. Inventory
| Item | Status | Files | Tests |
|---|---|---|---|
| Reagents and consumables with lots / expiry | Done | `inventory/inventory.service.ts`; web `InventoryPage.tsx` | `stock-math.node.test`, `inventory.e2e` |
| Consumption rules per test (automatic FEFO deduction per run and rerun, shortfall never blocks results) | Done | `consumeForRun`, hook in `results.service.persistIn` | `inventory.e2e` |
| Reorder levels, suppliers, POs, goods receipt (weighted average cost) | Done | `reorderSuggestions`, `createPo`, `receive` | `inventory.e2e` |
| Stock counts and adjustments (append-only ledger) | Done | `startCount/completeCount`, `adjust`, `StockMovement` trigger | `inventory.e2e` |
| Cost per test (theoretical and actual) | Done | `costPerTest` | `inventory.e2e` |

## 7. Reporting and release
| Item | Status | Files | Tests |
|---|---|---|---|
| Sign-off (pathologist), consent-checked release, critical value acknowledgement + escalation, secure link/QR | Done (existing) | `release/*`, `critical/*` | `golden-flow`, `safety-stop-ship.e2e` |
| Report templates per lab (bilingual AR/EN, branding, logo, QR, PDF) | Done | `release/templates.service.ts`, `report-pdf.ts`; web `SettingsExtras.tsx` `TemplatesTab` | `report-pdf.node.test`, `reporting.e2e` (signed report immutable) |
| Cumulative reports | Done | `registry/cumulative-pdf.ts` | `reporting.e2e` |
| Delivery via email / WhatsApp / SMS | Done (mock) | `release/delivery.service.ts` (mock messaging adapter, consent-checked, links only) | `reporting.e2e` |
| Doctor portal view | Done | see section 1 | `registry.e2e` |
| QR verification page | Done | `reports.service.verifyPublic`, web `/verify/:id` | `reporting.e2e` |

## 8. Billing and finance
| Item | Status | Files | Tests |
|---|---|---|---|
| Price lists, invoices, payments, partial payments, cash close | Done (existing, extended) | `business/billing.service.ts` | `billing.e2e`, `finance.e2e` |
| Insurance / B2B contract pricing (discount, payer share) | Done | `B2bAccount.kind/discountPercent/coveragePercent`, `invoiceOrder` | `finance.e2e` |
| Discounts (approval threshold, allocation to lines) | Done | `allocateDiscount`, `DISCOUNT_NEEDS_APPROVAL` | `aging.node.test`, `finance.e2e` |
| Payer settlements (transfer / cheque, BANK ledger account) | Done | `pay(... payer)` | `finance.e2e` |
| Refunds (partial, cumulative) | Done | `refund`, `Refund` (append-only) | `finance.e2e` |
| Referrer commissions | Done | section 1; `finance.commissions` | `registry.e2e`, `finance.e2e` |
| Receivables aging | Done | `business/finance.service.ts`, `aging.ts`; web `FinancePage.tsx` | `aging.node.test`, `finance.e2e` |
| Expenses (drawer expenses net the cash close) | Done | `finance.service` | `finance.e2e` |
| Send-out costs | Done (existing) | `insights.service` | `billing.e2e` |
| VAT as lines only | Done | invoice VAT columns | `billing.e2e`, `no-tax-authority.node.test` |
| CSV / PDF exports | Done | `exports.service.ts` (11 kinds), `common/table-pdf.ts` | `billing.e2e`, `finance.e2e` |

## 9. Admin and analytics
| Item | Status | Files | Tests |
|---|---|---|---|
| Staff, roles / permissions matrix (receptionist, phlebotomist, technician, supervisor, pathologist, finance, admin) | Done | `auth/rbac.ts` (9 roles), `GET /rbac`; web Settings | `tenancy-rbac.e2e`, `admin-analytics.e2e` |
| Branches / sections, settings (report header/footer, units, languages) | Done | `admin.service` (`updateLab`, `defaultLocale`), `catalogue-import.service.units`, templates | `admin-analytics.e2e` |
| Import of the test catalogue from CSV | Done | `catalogue/catalogue-import.service.ts`, `common/csv.ts`; web Settings > Import | `csv.node.test`, `admin-analytics.e2e` |
| TAT dashboards, workload, revenue per test / referrer / branch, positivity and volume statistics | Done | `analytics/reports.service.ts` | `stats.node.test`, `admin-analytics.e2e` |
| At least 15 report types | Done: 22 | `analytics/reports.service.ts` (volume, sources, top tests, TAT by section, TAT breaches, workload by staff and by instrument, demographics, abnormal rate, critical values, rejection rate, QC failures, microbiology positivity, revenue by test / referrer / branch / payer, collections by method, receivables aging, expenses, commissions, reagent consumption) | `admin-analytics.e2e` runs every report as JSON, CSV and PDF |

## 10. Integration stays optional
| Item | Status | Files | Tests |
|---|---|---|---|
| Standalone mode first-class, integrated optional behind a setting | Done | `Tenant.integrationMode`, `outbox.service.ts`, `integration-auth.service.ts`; web Settings > Operating mode | `admin-analytics.e2e` (standalone refuses partners, produces no outbox rows, full flow works; integrated unchanged), `integration.e2e`, `nurse-samples.e2e` |
| Orders in / results out / nurse-collected samples (KNLAB01) | Done (existing, unchanged when integrated) | `integration/*` | `integration.e2e`, `nurse-samples.e2e` |
| Documented standalone vs integrated | Done | `Docs/README.md`, `Docs/RUNBOOK.md` | `npm run docs:check` |

## Not possible / out of scope (and why)
- **CLSI / EUCAST antimicrobial breakpoints and automatic S/I/R interpretation**: licensed material. The bench enters S/I/R from its own tables (`NEEDS_HUMAN`).
- **Full ICD-10 / SNOMED**: licensed/large; a small synthetic hint list is shipped for typeahead and test suggestions only.
- **Real email / WhatsApp / SMS / PSP providers and real label printers**: mock adapters by founder decision (go-live pass; ZPL is generated for printers but no printer driver is wired).
- **Live analyzer hardware**: HL7/ASTM parsing, file import and the simulator are real code paths; no device was available.
- **Date back-shifting in the seed** needs a superuser (`session_replication_role`); on a restricted role the seed still completes with current dates.
