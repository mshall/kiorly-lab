# Home collection on `@kiorly/field-visit` (KLORD04, ADR-030)

Rev 2.3. The Lab consumes the shared package; it never re-implements the lifecycle, the privacy rule or the safety protocol.

## Consuming the package
`@kiorly/field-visit` 0.1.0 is built in `clinics-management/packages/field-visit` and is not published (NEEDS_HUMAN: registry access). The built package is **vendored as a tarball**: `vendor/kiorly-field-visit-0.1.0.tgz`, referenced as `"@kiorly/field-visit": "file:../../vendor/kiorly-field-visit-0.1.0.tgz"` in `apps/api/package.json` (so a standalone clone installs with `npm ci`). To update: `npm pack` in the package (after `npm run build -w @kiorly/field-visit`), replace the tarball, bump the filename in `apps/api/package.json`, `npm install`. A breaking change in the package is a major with 90-day dual support (ADR-027). Contracts: `@kiorex/contracts` 1.5.0 (`../../../kiorex-contracts/dist-pack/kiorex-contracts-1.5.0.tgz`).

## Where the package is used
| Need | Package API | Lab code |
|---|---|---|
| Status machine, geostamp check-in, no-show rules | `applyEvent`, `noShowAllowed` | `modules/field-safety/field-lifecycle.service.ts` (`HomeCollection.status` <-> `VisitState`, `field-visit-map.ts`) |
| Coverage zones (HVBK01) | `isInCoverage`, `buildTravelMatrix`, `normalizeDistrictId` | `OrdersService.bookHome`, `PUT /labs/:id/coverage` (`Lab.coverageDistricts/maxTravelMinutes/startDistrictId/travelMatrix`) |
| Travel buffers 30/30, daily cap, travel feasibility (HVCFG01/03) | `canBook`, `DEFAULT_TRAVEL_BUFFERS` | `HomeCollectionService.assign` (`Tenant.homeBufferBeforeMin/AfterMin/homeDailyCap`) |
| Coarse geostamps | `coarsen` (inside `applyEvent`) | `HomeCollection.history` (JSON) |
| Address privacy (HVPRV01, BR52) | `canViewAddress`, `maskedAddress` | `presentHomeCollection` on every home-collection read |
| Safety timer / SOS / alert delivery (HVSAF01/02, BR61) | `evaluateSafety`, `answerSafetyPrompt`, `buildSos`, `deliverSafetyAlert` | `field-safety.service.ts`, `lab-safety-dispatchers.ts` (SMS then WhatsApp through the messaging port, mock by default) |

## Safety protocol (never switchable, ADR-025)
- Constants come from the package: prompt 30 min after the planned end, answer window 10 min, delivery SLA 60 s, emergency numbers 123 / 122.
- The org safety contact (`Tenant.safetyContactName/Phone`, Settings) is mandatory before a collector can depart, SOS or leave (`409 SAFETY_CONTACT_REQUIRED`).
- Timer: `FieldSafetyService.tick(now)` every 10 s (runs unless `NODE_ENV=test`; there is deliberately no flag, plan or env switch; `TIMERS_ENABLED` is not honoured). Prompts and alerts fire once; an alert that could not be delivered is stored (`SafetyAlert.delivered=false`) and retried every tick; a late delivery is recorded `withinSla=false`.
- Alerts carry ids, coarse last position and emergency numbers only. SOS live location is delivered to the contact and **not stored**.
- "Leave visit - unsafe": category reason only, order stays `AWAITING_COLLECTION`, `FAILED`/no-show is refused afterwards, the safety contact is alerted. A collector on site who cannot collect ends the visit with `/fail` (status `FAILED`, timer stops).
- `modules/field-safety/` is a registered safety path: `safety-controls.node.test.ts`, the flags-off suite and `home-safety.e2e.test.ts` fail if a flag, entitlement or env switch appears there. With `lab.home_collection` OFF (or after a plan downgrade) SOS, "I'm OK", leave-unsafe and the timer keep working for a collector already in the field; starting new visits stays a feature endpoint.
- Protocol numbers are CMO-signed-protocol territory (gate GHV2 equivalent for labs: NH-LB-035). Real alert channels are mocked until the provider go-live pass.

## Not done / follow-ups
- Home address is stored as plain text in `HomeCollection.address` (Clinic encrypts a snapshot): column encryption with the platform KEK is a follow-up.
- Reception sees the district only once a collection is assigned: dispatchers who must phone patients need a policy decision (NH-LB-031).
- The Kiorex `labSlots` read side does not filter by district (the contract has no district parameter); coverage is enforced at booking (`OUT_OF_COVERAGE`).
