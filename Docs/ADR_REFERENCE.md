# ADR reference — Kiorly Lab

Binding decisions from KX-01 that shape this repo. ADR numbers are used in commit messages and Docs, as in clinics-management.

| ADR | Decision | How it applies here | Where enforced |
|---|---|---|---|
| ADR-004 | Share a commerce kernel by package, not by service | Plans, billing, ledger and settlement come from `@kiorly/commerce-kernel` (LB-F09). Never copy kernel code. | Package dependency; no kernel code in this repo |
| ADR-006 | Integration via HMAC REST + transactional outbox | Events leave only through OutboxEvent in the same transaction; flag snapshot calls use the HMAC scheme. | OutboxEvent table; signControlRequest |
| ADR-012 / ADR-013 | Kiorex Account OIDC; clinical data never in identity | Staff authenticate via Kiorex Account; tokens carry no clinical data. | LB-F07 |
| ADR-014 | Per-market configuration through market packs | No hard-coded Egypt or currency in logic; `marketCode` on Tenant. | Tenant.marketCode |
| ADR-015 | Hosting: AWS, Egypt tenants in the Frankfurt cell | Infra is written separately (OpenTofu). No deploys until the founder says so. | infra/ (not this scaffold) |
| ADR-017 | Pharmacy and Lab start as Kiorly SaaS before any Kiorex commerce | Pilot M19 / GA M21; Kiorex test bookings come after. | Phase map in the build sequence |
| ADR-023 | Everything ships ON; super admin can switch any capability OFF | Product flags: `lab.module`, `lab.analyzer_interfaces`, `lab.home_collection`, `lab.kiorex_bookings`. OFF => 403 FEATURE_DISABLED {key,scope}; never hides data. | FeatureFlagsService, RequiresFlagGuard, OFF contract tests |
| ADR-024 | Launch-locked flags need gate evidence | Kiorex-side `kiorex.lab_bookings` is launch-locked (counsel memo). Gate evidence is recorded by a human only. | Evaluator honours launchLocked/gateSatisfied from the snapshot |
| **ADR-025** | **Safety controls are never feature flags** | See table below. CI rejects flag keys on safety paths; evaluator throws for safety keys; DB triggers/CHECKs back the critical ones. | safety-controls.ts + safety-controls.node.test.ts + migration invariants |
| ADR-026 | 2025 repositories are references, not foundations | Entities were re-modelled as design notes only; no code copied. | Docs/DESIGN_NOTES_FROM_2025.md |
| ADR-027 | Shared code ships as versioned packages on GitHub Packages | `@kiorex/contracts` and `@kiorly/commerce-kernel` consumed as packages. | LB-F09, LB-F11 |
| ADR-028 | Infrastructure as code with OpenTofu | Not part of this scaffold; no CDK/CloudFormation; no `@aws-sdk/*` outside `src/platform/adapters/*` when added. | infra/ owned separately |

## ADR-025 safety controls (never flags, in every edition including Lite)

| Control id | Rule | Requirements | Enforcement (current / planned) |
|---|---|---|---|
| `safety.lab.qc_block` | Westgard violation (1-3s, 2-2s, R-4s, 4-1s, 10x) blocks patient release | KLQC02 | DB trigger kx_enforce_qc_before_release + service (LB-SS01) |
| `safety.lab.authorized_release` | Release requires technical + medical validation and signed report version | KLQC04, KLCRIT02 | DB CHECKs result_release_requires_qc_and_signature, report_version_signed; NOT NULL FK ReleaseRecord -> ReportVersion |
| `safety.lab.critical_value_escalation` | Unacknowledged critical value escalates after configured minutes | KLCRIT01 | Timer job (KLCRIT01, LB-SS02); CHECK on ack deadline |
| `safety.lab.accession_uniqueness` | Duplicate accession numbers are rejected | KLSPC01 | DB unique (labId, accessionNumber) (LB-SS04) |
| `safety.lab.custody_append_only` | Chain of custody is append-only | KLSPC03 | DB trigger custody_event_append_only |
| `safety.lab.label_match` | Mislabelled specimens cannot be processed (label mismatch scan blocks) | KLSPC02, KLSPC04 | Service scan check (KLSPC02, LB-SS03) |
| `safety.lab.audit_logging` | State changes affecting results, access, money are audited | KX-08 §09 | AuditLog writes in services (PH-F08 / LB-F08) |
| `safety.lab.consent_enforcement` | Result release channels require consent | KLORD03, KLCRIT02 | Service (KPRX01 / KLCRIT02) |
| `safety.lab.tenant_isolation` | Tenant isolation and authorization | KX-08 §09 | orgId on every table + guard (F07); schema smoke test asserts orgId |
| `safety.lab.privileged_mfa` | Privileged MFA on production | KX-08 §09 | Auth guard (F07) |

Also not flags per KX-08 §09: Rx safety checks, encounter sign-off/audit, record view/print/export for the tenant, privileged MFA on production, tenant isolation and authorization, breach-response tooling.

## Adding a flag (checklist)

1. Not a safety control (check the table above). 2. Key `lab.<name>`, ships ON, with a dependency on `lab.module` where sensible. 3. Register in the Kiorex registry (needs human). 4. Add to `feature-flag-keys.ts` and `packages/shared`. 5. Write the OFF contract test (403 FEATURE_DISABLED {key,scope}). 6. Never place `@RequiresFlag` in a safety-path directory (`specimens, analysis-qc, release, critical`).
