# Kiorly Work — Lab mobile API (staff app)

Backend for the **Kiorly Work** Expo staff app (repo `kiorly-work`), Lab module. Base URL `http://localhost:3200/api/v1` (prefix `/api/v1`).
Everything below is real, tested code (`apps/api/test/mobile.e2e.test.ts`, `src/modules/mobile/mobile.node.test.ts`). Providers are mocked (`MOBILE_PUSH_MODE=mock` default).

## Auth (what the app signs in with)
- **Local/dev (`AUTH_MODE=dev`, default):** `POST /auth/dev-login {orgSlug, email}` -> `{token, user:{id,displayName,role}}`. HS256 JWT, 12 h, `aud=kiorly-lab`, `iss=kiorly-lab-dev`, claims `staffId`, `amr:["pwd","mfa"]`. No password (dev only, refused in production). `GET /auth/dev/orgs` lists orgs for a picker. Used with `Authorization: Bearer <token>`.
- **Production (`AUTH_MODE=oidc`):** Kiorex Passport RS256 access token (audience `kiorly-lab`, issuer `KIOREX_OIDC_ISSUER`, JWKS at `/jwks`), obtained by the app with OIDC authorization-code + PKCE (public client, redirect `kiorlywork://auth/callback`). The Lab API validates the token (ADR-012/013) and **always takes role and tenant from its own `StaffUser` row** (matched by `subject`), never from the token. Registering the `kiorly-work` public client in Passport is NEEDS_HUMAN (client config lives in kiorex-account).
- Privileged roles (OWNER, LAB_DIRECTOR, AUTHORIZED_SIGNATORY) need an `mfa|otp|hwk|swk` amr claim when `FORCE_PRIVILEGED_MFA`/production.
- The app must send `X-Kiorly-Client: kiorly-work/<version>` on every request, plus `X-Kiorly-Device: <device id>` and `X-Kiorly-Device-Token: <token>` after registration.

## Plans and entitlement
Lab "plan" is the existing tenant `edition`: `LITE` = **BASIC**, `PRO` = **PRO**, `CHAIN` = **ENTERPRISE**. Entitlement `mobile_staff_app` is ON for PRO/ENTERPRISE, OFF for BASIC. A Kiorex control-plane snapshot row `mobile_staff_app` with `values.global|markets|orgs.<id> = "OFF"` switches it off for PRO orgs too (`reason: FLAG_OFF`). It is a commercial entitlement, **not** a safety control. See `FeatureFlagsService.evaluateEntitlement`.
Not (yet) in `@kiorex/contracts` `flags/catalogue.json` (a test pins the lab flag list to that catalogue); needs a contracts change `mobile_staff_app` (Module, no deps, not launch-locked) before the Kiorex console can list it.

Enforcement (`MobileGuard`, global, after AuthGuard):
- Every `/mobile/*` route and every request with `X-Kiorly-Client: kiorly-work*` without the entitlement -> `403 {code:"FEATURE_DISABLED", key:"mobile_staff_app", scope:"org", reason}`.
- **Exempt on every plan (ADR-025):** `/auth/*`, `GET /mobile/bootstrap`, `/mobile/alerts*`, `POST /mobile/upgrade-request`, `DELETE /mobile/devices/:id`.

## New endpoints
| Method / path | Perm | Notes |
|---|---|---|
| `GET /mobile/bootstrap` | any staff | `{apiVersion:1, product:"lab", serverTime, user:{id,name,email,role,roles[],locale,signatory}, org:{id,name,slug,plan,rawPlan,marketCode,currency,integrationMode}, labs[], entitlement:{key,enabled,requiredPlan:"PRO",reason}, safetyAlertsOnly, modules:[{key,enabled,screens[]}], permissions[], device:{id,status}\|null}`. Entitlement off -> `modules:[]`, `permissions:[]`, `safetyAlertsOnly:true`. Module keys: `lab.phlebotomy, lab.accession, lab.critical, lab.validation, lab.worklist, lab.qc, lab.tat, lab.orders, lab.reagents` (enabled per role permissions, `screens` per permission, e.g. `sign-off` only for medical validators). |
| `POST /mobile/devices` `{deviceId(uuid), platform:"ios"\|"android"\|"web", name, appVersion?, pushToken?}` | any staff + entitlement | 201 `{id, deviceId, deviceToken, status:"ACTIVE"}`. `deviceToken` shown once (stored sha256). Re-registering the same `deviceId` rotates the token (old one -> 401) and reactivates a revoked device. |
| `GET /mobile/devices` | own; `staff.manage` (OWNER, LAB_DIRECTOR, BRANCH_MANAGER) sees the whole tenant | `{items:[{id,deviceId,platform,name,appVersion,status,hasPushToken,lastSeenAt,staff:{id,name},mine}]}` |
| `DELETE /mobile/devices/:id` | own device, or `staff.manage` (remote sign-out) | `{id,status:"REVOKED"}`, idempotent, audited, clears the push token. Any later request carrying that device headers -> `401 {code:"DEVICE_REVOKED"}`. Lab has no refresh sessions (dev tokens are 12 h; production tokens come from Passport), so revocation is the device-bound control; the app must also drop its local session on `DEVICE_REVOKED`. |
| `PUT /mobile/devices/:id/push-token` `{token, provider:"expo"\|"mock"}` | owner of the device | |
| `GET /mobile/inbox?limit&cursor` | own | `{items:[{id,kind:"GENERAL"\|"SAFETY"\|"CLINICAL"\|"OPS",title,titleAr,body,bodyAr,data,createdAt,readAt}], nextCursor, unread}` |
| `POST /mobile/inbox/:id/read`, `POST /mobile/inbox/read-all`, `POST /mobile/push/test` | own | |
| `GET /mobile/alerts?status=open\|all` | role-scoped, **no entitlement** | `{items:[Alert], open}`; Alert `{id, kind, severity, title,titleAr, body,bodyAr, subject:{type,id,label}\|null, raisedAt, dueAt, ackedAt, ackedBy, ackedByName, ackNote, escalationLevel?}` |
| `POST /mobile/alerts/:id/ack {note?}` | per kind (see below), **no entitlement** | Idempotent (first acknowledger kept). Returns the Alert. |
| `POST /mobile/upgrade-request {featureKey?, note?}` | any signed-in staff, **no entitlement** (exempt like alerts) | Basic-org staff ask the owner for the plan that includes Kiorly Work. `featureKey` = a module key or `general` (400 otherwise); `note` <= 500 chars. Records requester, role, org, feature, note, time (`MobileUpgradeRequest`); a repeat by the same user for the same feature within **24h** returns the original with `deduped:true` (no second notification). Notifies the org owner(s) via the mock mobile push inbox (kind `OPS`, template `UPGRADE_REQUEST`) and audits `mobile.upgrade_requested`. Response `{id, status:"REQUESTED"\|"ALREADY_ENTITLED", featureKey, requestedAt, deduped, notified}` (`ALREADY_ENTITLED` = nothing recorded). |
| `GET /mobile/summary` | any staff + entitlement | Home counters, each `null` when the role may not see it: `ordersToday, awaitingCollection, inLab, pendingTechValidation, pendingMedicalValidation, openCriticalValues, openQcBlocks, tatBreaches24h, reagents:{lowStock,expiringLots}, unreadInbox, openAlerts` |
| `GET /mobile/scan?code=` | `specimens.read` | Resolves a specimen **barcode or accession number** (or an **order number**) -> `{type:"SPECIMEN", matchedBy, specimen:{id,accessionNumber,barcode,specimenType,container,status,collectedAt}, order:{id,orderNumber,priority,status,patient}, tests[], custody[last 5], nextActions:[{action,to,requiresScan,allowed}]}` or `{type:"ORDER", order, specimens[]}`; 404 `SPECIMEN_NOT_FOUND`. `allowed` reflects the caller's permission; then call the action endpoint below with `scannedBarcode`. |
| `GET /mobile/search?q=` (min 2 chars) | per entity permission | `{patients[], orders[], specimens[]}` (8 each) |
| `GET /mobile/worklist/progress` | `results.read` | `{windowDays:7, sections:[{section,total,pending,inProgress,resulted,validated,released,percentDone}]}` |
| `GET /mobile/reagents/low-stock` | `inventory.read` | `{lowStock:[{id,code,name,nameAr,unit,onHand,reorderLevel,reorderQty,supplier}], expiring:[{…,expiringLots,expiredQty,nextExpiry}]}` |

`GET /mobile/bootstrap` also returns `upgrade` on non-entitled orgs only (`null` on Pro): `{lockedModules:[key], myRequest:{featureKey,requestedAt}|null, openRequests:number|null, openRequestItems:[{id,featureKey,requesterRole,requesterName,requestedAt,note?}] (newest 10 open requests from other people, approvers only, display name only; [] otherwise), canApprove:boolean}`. `lockedModules` = the modules THIS role would get on Pro (same role rules as the Pro bootstrap), so the app renders only role-relevant locked tiles; `myRequest` = my latest request in the last 24h; `openRequests`/`canApprove` are for owner/admin.

### Safety alerts (ADR-025) — derived from existing safety data
| kind | source | visible/ack permission | severity |
|---|---|---|---|
| `CRITICAL_VALUE` (`crit_<criticalAlertId>`) | `CriticalAlert` (OPEN/ESCALATED = open) | read `critical.read`, ack `critical.ack` (uses `CriticalService.acknowledge`; audited `critical.acknowledged`) | CRITICAL |
| `TAT_BREACH_CRITICAL` (`tat_<slaAlertId>`) | `SlaAlert` on STAT/URGENT orders still unreleased | `dashboard.read` | CRITICAL (STAT) / HIGH |
| `QC_FAILURE` (`qc_<qcBlockId>`) | `QcBlock` OPEN | `qc.read` | HIGH |
| `HOME_COLLECTION_SAFETY` (`safety_<safetyAlertId>`) | `SafetyAlert` (no answer / SOS / unsafe abort) | `collection.manage` | CRITICAL / HIGH |
Derived kinds are acknowledged through `MobileAlertAck` (audited `mobile.alert_acknowledged`). Texts are bilingual and never contain raw result values (KLCRIT03). The module `src/modules/mobile-alerts` is a registered safety path: a unit test forbids flag/entitlement references there.

### Mock push (MOBILE_PUSH_MODE=mock)
`MobilePushService` writes the staff in-app inbox row (status DELIVERED, provider `mock`). Hooked into: critical value + escalation and SLA/TAT + collector-safety PUSH notifications (mirrored from `MessagingAdapter`), "order awaiting medical validation" (after the last result of an order is technically validated, to signatories/directors), "reagent has no usable stock" (consumption shortfall, to manager/supervisor/owner). `MOBILE_PUSH_MODE=real` throws until the Expo provider is wired in the go-live pass (add to `Docs/NEEDS_HUMAN.md` "Provider go-live": Expo push credentials, APNs/FCM keys, template approval NH-LB-018).

## App API map (existing endpoints the app uses)
All need entitlement + the permission shown. Errors: `{code, ...}`; 403 `FORBIDDEN {required:[perm]}`; 409 for state-machine violations.

### Phlebotomy round with specimen label scanning + chain of custody
- Today's route (home collections): `GET /home-collections/my-route?date=YYYY-MM-DD` (`collection.perform`; flag `lab.home_collection` + PRO). Stops: `POST /home-collections/:id/start {geostamp?}`, `/arrive {geostamp:{lat,lng,accuracy?,at?}}`, `/fail`, `/label-photo`, `/confirm {scannedBarcodes[], identifiersChecked?, labelPhotoKey?, temperatureC?}`. Safety (field-visit): `POST /home-collections/:id/safety/answer`, `/sos {lat,lng}`, `/leave-unsafe` (all `collection.perform`, never flag-gated).
- Scan label: `GET /mobile/scan?code=` (above), then `POST /specimens/:id/collect {scannedBarcode, temperatureC?, location?, note?}` (`specimens.collect`). Mismatched label -> 4xx (safety.lab.label_match). Transport: `POST /specimens/:id/transport` (same body). Reject: `POST /specimens/:id/reject {reason, note?}` (`specimens.reject`).
- Chain of custody: `GET /specimens/:id/custody` (`specimens.read`) -> `[{id,type:"COLLECTED",actorId,location,temperatureC,note,occurredAt}]` (append-only).
- Pending specimens: `GET /specimens?status=PENDING_COLLECTION&search=`.

### Accessioning scan
`GET /mobile/scan?code=` -> `POST /specimens/:id/receive {scannedBarcode, temperatureC?}` (`specimens.receive`), `POST /specimens/:id/process {scannedBarcode}` (`specimens.process`), `POST /orders/:orderId/accession {accessionNumber?}` and `GET /specimens/:id/label`, `GET /orders/:orderId/labels` (`specimens.label`). Example order scan: `{"type":"ORDER","order":{"orderNumber":"ORD-2026-000227","priority":"ROUTINE","status":"AWAITING_COLLECTION","patient":{"fullName":"Hana Kamel (DEMO)"}},"specimens":[{"accessionNumber":"CAI2611200089","status":"PENDING_COLLECTION"}]}`.

### Critical-value acknowledge / escalation
List + ack via `/mobile/alerts` (above; works on every plan). Web equivalents: `GET /critical-alerts?status=OPEN|ESCALATED|ACKNOWLEDGED` (`critical.read`), `POST /critical-alerts/:id/ack {note?}` (`critical.ack`; 409 `ALERT_ALREADY_ACKNOWLEDGED` on the web route, idempotent on the mobile route). **Read-back note (single source of truth):** both routes store the trimmed note (max 500 chars, blank = none) in `CriticalAlert.readBackNote` (migration `20261121120000_critical_alert_read_back_note`, nullable) inside the same transaction as the status change; the first acknowledger wins and a replay (409 on web, unchanged alert on mobile) never overwrites the note or acknowledger. `GET /critical-alerts` returns `readBackNote`; `/mobile/alerts` returns it as `ackNote` (legacy `MobileAlertAck` notes are a read fallback only). The note is audited as `hasNote` only and is never put in notification params or alert text (no PHI). Escalation is automatic (timer: clinician + director, level 1 director, level 2 owner; `escalationLevel`, `dueAt` = next deadline). Example open alert: `{"id":"crit_cmwo0rmae0126s3s8kkpxddmr","kind":"CRITICAL_VALUE","severity":"CRITICAL","title":"Escalated critical K","escalationLevel":2,"ackedAt":null,...}`.

### Result validation / sign-off for pathologists
- Queue: `GET /validation-queue?stage=tech|medical` (`results.read`) -> rows `{id, orderItemId, analyteId, status:"TECH_VALIDATED", valueNumeric, unit, flag, refLow, refHigh, deltaPercent, deltaCheckFailed, analyte:{code,nameEn,unit}, orderItem:{order:{id,orderNumber,patient:{fullName,sex}}}, specimen:{accessionNumber}}`.
- Order results: `GET /orders/:orderId/results`. Tech validate: `POST /results/:id/tech-validate {deltaAcknowledged?, note?}` (`results.tech_validate`; 409 `DELTA_CHECK_ACK_REQUIRED`, `DUAL_CONTROL_REQUIRED`, QC gates). Medical validate: `POST /results/:id/medical-validate` or whole order `POST /orders/:orderId/medical-validate` (`results.medical_validate`, signatory with licence). Sign report: `POST /orders/:orderId/reports` (`reports.sign`); readiness `GET /orders/:orderId/report-readiness`; ready list `GET /release-queue` -> `{readyToSign:[{orderId,orderNumber,patient}], signedNotReleased:[]}`; release `POST /reports/:id/release {channels[]}` (`reports.release`).

### Worklist progress
`GET /worklist?status=PROCESSING|RECEIVED&section=&instrumentId=&priority=` (`results.read`) -> specimens with `items[].analytes/results`; counts per section: `GET /mobile/worklist/progress`. Result entry on the bench: `POST /results {orderItemId, analyteId, instrumentId, value|valueText}` + `POST /results/:id/second-entry {value}` (dual control).

### QC status
`GET /qc/blocks` (`qc.read`) -> `[{id,instrumentId,analyteId,status:"OPEN",rule:"1_3s",openedAt,instrument:{name},openedByRun:{zScore:"3.6",status:"FAIL"}}]`; `GET /qc/runs`, `GET /qc/levey-jennings`, `GET /instruments`, `GET /qc/materials`; run QC `POST /qc/runs {instrumentId, materialId, value}` (`qc.run`); clear block `POST /qc/blocks/:id/clear` (`qc.clear_block`). Alert form: `QC_FAILURE`.

### TAT alerts
`GET /tat?from&to` (`dashboard.read`) -> `{summary:{total,ok,atRisk,breached,doneOnTime,doneLate}, rows:[{orderItemId,orderId,orderNumber,priority,test,targetMinutes,startedAt,releasedAt,status:"OK|AT_RISK|BREACHED|DONE_*|NO_TARGET",elapsedMinutes,percent,alerted}]}`; alerts `TAT_BREACH_CRITICAL` + mock push `SLA_ALERT` (raised by `POST /tat/sla-sweep` / timer). Dashboard: `GET /dashboard`.

### Today's orders
`GET /orders?from=<ISO day start>&status=&search=&limit=&offset=` (`orders.read`) -> `{total, rows:[{id, orderNumber, status, priority, source, createdAt, ...}]}`; detail `GET /orders/:id` (items, specimens, patient). Counters: `GET /mobile/summary`.

### Reagent low-stock alerts
`GET /mobile/reagents/low-stock` (new), plus `GET /inventory/summary` (`{items,lowStock,expiringLots,expiredQty,stockValue,shortfalls30d,openPos}`), `GET /inventory/stock?low=true`, `GET /inventory/reorder-suggestions`, `GET /inventory/items/:id/lots` (`inventory.read`). Mock push `REAGENT_LOW_STOCK` on a consumption shortfall.

### Global search
`GET /mobile/search?q=` (new) and for a full result set `GET /orders?search=`, `GET /patients?search=`, `GET /specimens?search=`.

## Registering the app with Passport (NEEDS_HUMAN)
OIDC public client `kiorly-work` (PKCE S256, redirect `kiorlywork://auth/callback`, audience `kiorly-lab`) in kiorex-account; until then the app uses dev-login locally.
