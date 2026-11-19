# Design notes harvested from the 2025 prototype (lab-service)

**Status:** design input only (ADR-026, KX-22 §08). Source: `_legacy/kiorex-backend/services/lab-service` (read-only). **No code was copied**; these are the *ideas* worth keeping and the mistakes to avoid. The v2 model lives in `apps/api/prisma/schema.prisma` (DRAFT).

## What the 2025 model looked like

| 2025 entity | Ideas worth keeping | Problem to fix in v2 | v2 model |
|---|---|---|---|
| LabTest | Category (blood/urine/imaging/cardiac/diabetes/...), type single/package/profile, price, duration in hours, preparation text, sample type, home-collection availability, active flag | Test parameters as a string list and one `normalRange` string; no analytes, no reference intervals; category enum too coarse | `TestDefinition` + `Analyte` + `TestAnalyte`, `TestPackage`, versioned `ReferenceInterval` (KLORD01, KLQC03) |
| LabBooking | Status incl. no-show, collection type lab visit/home, address, preferred time slot, contact phone, cancellation reason/time, collected-by person, appointment link (booked during consultation) | A booking conflated order, payment, collection and result; no accession or specimen | `LabOrder` + `OrderItem`; `HomeCollection` (slots, phlebotomist, route, label photo); `Specimen`; payments move to the commerce kernel |
| LabResult | Per-parameter value/unit/range/severity, abnormal flag + notes, summary and recommendations, reviewed-by, PDF url, statuses pending..critical | Parameters as a JSON array (no queryable values, no delta checks); single `reviewedBy`; no QC link, no signature, no versioning; "critical" is just a status | One `Result` row per analyte with source, dual control, tech + medical validation, QC run link; `ReportVersion` (signed, versioned, correction reason); `CriticalAlert` with ack deadline and escalation |
| LabPartner | Directory profile (hours, facilities, certifications, geo, home-collection fee, rating) | It models a marketplace listing, not a LIMS tenant | Belongs to Kiorex marketplace listings; here only `Lab` (site) config plus the Kiorex booking contract |

## Harvested ideas, mapped to requirements

- Test types single/package/profile → `TestDefinition` + `TestPackage` (KLBIZ01 check-up packages).
- Booking status vocabulary (pending, confirmed, in progress, completed, cancelled, no-show) → `OrderStatus` and `HomeCollectionStatus`; no-show applies to home collection only.
- Severity levels on results (mild/moderate/severe/critical) → `ResultFlag` (LOW/HIGH/CRITICAL_LOW/CRITICAL_HIGH/ABNORMAL); severity grading beyond critical is a discovery question.
- Preparation instructions and sample type on the test → `TestDefinition.prepInstructions*`, `specimenType`, `container`, `volumeMl`, `fastingRequired`.
- Operating hours / facilities / certifications on the lab → out of scope for LIMS tenancy; revisit for the Kiorex listing only.

## Do not carry over

TypeORM entities, JSON-blob parameters, a single reviewer field as "validation", Stripe/Twilio integrations, and any model where releasing a result is just a status change.

## Open modelling questions for discovery

1. Do labs report cultures/microbiology and imaging? (the 2025 category list included imaging; the draft schema is analyte/numeric-first with text values only.)
2. Panels with calculated analytes (e.g. LDL): where do formulas live?
3. Send-out (referral) lab flow: only a `sendOut` flag exists on `TestDefinition` today.
4. Multi-branch specimen routing between labs of one chain: not modelled in the draft.
