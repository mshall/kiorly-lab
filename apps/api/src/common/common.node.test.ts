import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { OrderItemStatus, SpecimenStatus } from "../generated/prisma/client";
import { classifyResult, deltaPercent, pickInterval } from "./clinical-flags";
import { channelConsented, hashNationalId, presentIdentifiers, twoIdentifiersOk } from "./identity";
import { deriveOrderStatus } from "./order-status";
import { ageInDays } from "./age";
import { open, seal } from "./secret-box";
import { classifyTat } from "../modules/business/tat";
import { csvCell, toCsv } from "../modules/business/exports.service";
import { haversineKm, nearestNeighbourRoute, defaultSlotsFor } from "../modules/orders/home-routing";
import { mfaSatisfied, ROLE_PERMISSIONS, PERMISSIONS, hasPermission } from "../auth/rbac";

describe("result classification", () => {
  it("applies strict bounds and critical limits first", () => {
    const iv = { low: 12, high: 15.5 };
    const cr = { criticalLow: 7, criticalHigh: 20 };
    assert.equal(classifyResult(12, iv, cr), "NORMAL");
    assert.equal(classifyResult(15.5, iv, cr), "NORMAL");
    assert.equal(classifyResult(11.9, iv, cr), "LOW");
    assert.equal(classifyResult(15.6, iv, cr), "HIGH");
    assert.equal(classifyResult(6.9, iv, cr), "CRITICAL_LOW");
    assert.equal(classifyResult(7, iv, cr), "LOW");
    assert.equal(classifyResult(20.1, iv, cr), "CRITICAL_HIGH");
    assert.equal(classifyResult(5, null, null), "NORMAL");
  });
  it("property: critical implies out of the reference range", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 100, noNaN: true }), (v) => {
      const f = classifyResult(v, { low: 10, high: 20 }, { criticalLow: 5, criticalHigh: 30 });
      return (f !== "CRITICAL_LOW" || v < 10) && (f !== "CRITICAL_HIGH" || v > 20) && (f !== "NORMAL" || (v >= 10 && v <= 20));
    }));
  });
  it("delta percent", () => {
    assert.equal(deltaPercent(15, 10), 50);
    assert.equal(deltaPercent(5, 10), -50);
    assert.equal(deltaPercent(5, null), null);
    assert.equal(deltaPercent(5, 0), null);
  });
  it("picks sex-specific, age-matching, effective, newest-version interval", () => {
    const base = { ageMinDays: 0, ageMaxDays: null, effectiveFrom: new Date("2026-01-01"), effectiveTo: null as Date | null };
    const cands = [
      { ...base, id: "a", sex: null, version: 1 },
      { ...base, id: "b", sex: "F", version: 1 },
      { ...base, id: "c", sex: "F", version: 2 },
      { ...base, id: "d", sex: "F", version: 3, effectiveFrom: new Date("2027-01-01") },
      { ...base, id: "e", sex: "M", version: 9 },
    ];
    assert.equal(pickInterval(cands, "F", 10000, new Date("2026-06-01"))?.id, "c");
    assert.equal(pickInterval(cands, "M", 10000, new Date("2026-06-01"))?.id, "e");
    assert.equal(pickInterval(cands, "OTHER", 10000, new Date("2026-06-01"))?.id, "a");
    assert.equal(pickInterval(cands, "F", 10000, new Date("2027-06-01"))?.id, "d");
    assert.equal(pickInterval([{ ...base, id: "kid", sex: null, version: 1, ageMaxDays: 100 }], "F", 5000, new Date("2026-06-01")), null);
  });
  it("age in days", () => assert.equal(ageInDays(new Date("2026-01-01"), new Date("2026-01-11")), 10));
});

describe("identity & consent (KLORD03)", () => {
  it("needs two distinct identifier kinds, each present on the record", () => {
    const present = presentIdentifiers({ dateOfBirth: new Date(), phone: "+20100", nationalIdHash: null, externalId: null });
    assert.deepEqual(present, ["dateOfBirth", "phone"]);
    assert.equal(twoIdentifiersOk(["dateOfBirth", "phone"], present), true);
    assert.equal(twoIdentifiersOk(["phone", "phone"], present), false);
    assert.equal(twoIdentifiersOk(["phone"], present), false);
    assert.equal(twoIdentifiersOk(["phone", "nationalId"], present), false);
    assert.equal(twoIdentifiersOk(["phone", "favouriteColour"], present), false);
  });
  it("consent is per channel and absence means no", () => {
    assert.equal(channelConsented(["PRINTED"], "PRINTED"), true);
    assert.equal(channelConsented(["PRINTED"], "KIOREX_VAULT"), false);
    assert.equal(channelConsented([], "PRINTED"), false);
  });
  it("national id hash is stable and not the raw id", () => {
    assert.equal(hashNationalId("29001011234567"), hashNationalId("2900101 1234567"));
    assert.ok(!hashNationalId("29001011234567").includes("2900101"));
  });
});

describe("order status derivation", () => {
  const ITEMS: OrderItemStatus[] = ["PENDING", "IN_PROGRESS", "RESULTED", "VALIDATED", "RELEASED", "CANCELLED"];
  const SPEC: SpecimenStatus[] = ["PENDING_COLLECTION", "COLLECTED", "IN_TRANSIT", "RECEIVED", "PROCESSING", "STORED", "DISPOSED", "REJECTED"];
  const d = (items: OrderItemStatus[], specimens: SpecimenStatus[] = ["PENDING_COLLECTION"]) => deriveOrderStatus({ cancelled: false, items, specimens, current: "AWAITING_COLLECTION" });
  it("walks the lifecycle", () => {
    assert.equal(d(["PENDING"]), "AWAITING_COLLECTION");
    assert.equal(d(["PENDING"], ["COLLECTED"]), "COLLECTED");
    assert.equal(d(["PENDING"], ["RECEIVED"]), "IN_LAB");
    assert.equal(d(["RESULTED", "IN_PROGRESS"], ["PROCESSING"]), "PARTIALLY_RESULTED");
    assert.equal(d(["RESULTED", "RESULTED"], ["PROCESSING"]), "AWAITING_VALIDATION");
    assert.equal(d(["VALIDATED", "VALIDATED"]), "VALIDATED");
    assert.equal(d(["RELEASED", "RELEASED"]), "RELEASED");
    assert.equal(d(["CANCELLED"]), "CANCELLED");
    assert.equal(d(["RELEASED", "CANCELLED"]), "RELEASED");
  });
  it("property: RELEASED only when every active item is released", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...ITEMS), { minLength: 1, maxLength: 6 }), fc.array(fc.constantFrom(...SPEC), { maxLength: 3 }), (items, specimens) => {
      const s = d(items, specimens);
      const active = items.filter((i) => i !== "CANCELLED");
      return (s !== "RELEASED" || (active.length > 0 && active.every((i) => i === "RELEASED"))) && (s !== "VALIDATED" || active.every((i) => i === "VALIDATED" || i === "RELEASED"));
    }));
  });
});

describe("TAT classification (KLBIZ02)", () => {
  const start = new Date("2026-11-20T08:00:00Z");
  const at = (m: number) => new Date(start.getTime() + m * 60_000);
  it("classifies open and released items", () => {
    assert.equal(classifyTat({ startedAt: start, targetMinutes: 120, releasedAt: null, now: at(60) }).status, "OK");
    assert.equal(classifyTat({ startedAt: start, targetMinutes: 120, releasedAt: null, now: at(100) }).status, "AT_RISK");
    assert.equal(classifyTat({ startedAt: start, targetMinutes: 120, releasedAt: null, now: at(121) }).status, "BREACHED");
    assert.equal(classifyTat({ startedAt: start, targetMinutes: 120, releasedAt: at(90), now: at(500) }).status, "DONE_ON_TIME");
    assert.equal(classifyTat({ startedAt: start, targetMinutes: 120, releasedAt: at(130), now: at(500) }).status, "DONE_LATE");
    assert.equal(classifyTat({ startedAt: start, targetMinutes: null, releasedAt: null, now: at(5) }).status, "NO_TARGET");
  });
});

describe("CSV export hygiene", () => {
  it("quotes, escapes and neutralises spreadsheet formulas", () => {
    assert.equal(csvCell('a,"b"'), '"a,""b"""');
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell("@cmd"), "'@cmd");
    assert.equal(csvCell("-5"), "-5");
    assert.equal(csvCell(null), "");
    assert.equal(toCsv(["a", "b"], [[1, "x"]]), "a,b\r\n1,x\r\n");
  });
});

describe("home collection routing", () => {
  it("haversine and nearest-neighbour ordering", () => {
    const cairo = { lat: 30.0444, lng: 31.2357 };
    const giza = { lat: 30.0131, lng: 31.2089 };
    assert.ok(haversineKm(cairo, giza) > 3 && haversineKm(cairo, giza) < 6);
    const stops = [{ id: "far", geo: { lat: 30.2, lng: 31.5 } }, { id: "near", geo: { lat: 30.05, lng: 31.24 } }, { id: "nogeo", geo: null }];
    assert.deepEqual(nearestNeighbourRoute(cairo, stops).map((s) => s.id), ["near", "far", "nogeo"]);
  });
  it("generates an hourly slot grid", () => {
    const s = defaultSlotsFor(new Date("2026-11-20T00:00:00Z"));
    assert.equal(s.length, 10);
    assert.equal(s[0].startsAt.toISOString(), "2026-11-20T08:00:00.000Z");
  });
});

describe("RBAC and secrets", () => {
  it("every permission is granted to someone, OWNER has all, phlebotomists cannot validate or release", () => {
    for (const p of PERMISSIONS) assert.ok(Object.values(ROLE_PERMISSIONS).some((r) => r.includes(p)), p);
    assert.equal(ROLE_PERMISSIONS.OWNER.length, PERMISSIONS.length);
    for (const p of ["results.medical_validate", "results.tech_validate", "reports.release", "reports.sign", "qc.clear_block"] as const) assert.equal(hasPermission("PHLEBOTOMIST", p), false);
    assert.equal(hasPermission("TECHNOLOGIST", "results.medical_validate"), false);
    assert.equal(hasPermission("RECEPTION", "reports.sign"), false);
    assert.equal(hasPermission("AUTHORIZED_SIGNATORY", "reports.sign"), true);
  });
  it("privileged roles need an MFA claim when enforced (production)", () => {
    assert.equal(mfaSatisfied("OWNER", ["pwd"], true), false);
    assert.equal(mfaSatisfied("OWNER", ["pwd", "mfa"], true), true);
    assert.equal(mfaSatisfied("AUTHORIZED_SIGNATORY", [], true), false);
    assert.equal(mfaSatisfied("RECEPTION", ["pwd"], true), true);
    assert.equal(mfaSatisfied("OWNER", [], false), true);
  });
  it("secret box round-trips and uses a fresh IV", () => {
    const a = seal("s3cret");
    assert.equal(open(a), "s3cret");
    assert.notEqual(a, seal("s3cret"));
  });
});
