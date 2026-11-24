import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPlan, skipKey, type LabSnap, type SetupSnapshot } from "./setup-plan";

const lab = (id: string, over: Partial<LabSnap> = {}): LabSnap => ({ id, name: `Lab ${id}`, code: id.toUpperCase(), licenceNo: null, address: null, coverageDistricts: 0, ...over });
const snap = (over: Partial<SetupSnapshot> = {}): SetupSnapshot => ({ labs: [lab("a")], testCount: 0, signatoryLicensed: false, otherStaff: 0, safetyContact: false, orderCount: 0, releasedReports: 0, connected: false, ...over });
const step = (p: ReturnType<typeof buildPlan>, k: string) => p.steps.find((s) => s.key === k)!;

describe("lab quick setup rules", () => {
  it("fresh lab: 0%, lab licence first, nothing manual, deep link carries the lab id", () => {
    const p = buildPlan(snap(), {}, { role: "OWNER" });
    assert.equal(p.progressPercent, 0);
    assert.equal(p.nextKey, "lab_licence");
    assert.ok(p.steps.every((s) => !s.manual));
    assert.equal(step(p, "lab_licence").href, "/settings?tab=labs&setup=lab_licence&entity=a");
  });
  it("completion comes from data: licence+address, catalogue, signatory with licence, order, released report", () => {
    const p = buildPlan(snap({ labs: [lab("a", { licenceNo: "L", address: "A" })], testCount: 12, signatoryLicensed: true, orderCount: 1, releasedReports: 1 }), {}, { role: "OWNER" });
    for (const k of ["lab_licence", "starter_catalogue", "signatory", "first_order", "first_report"]) assert.equal(step(p, k).status, "done", k);
    assert.equal(p.progressPercent, 100);
    assert.equal(p.allDone, false, "optional steps remain");
  });
  it("multi-lab: per-lab states, aggregate counts, a new lab reopens the step", () => {
    const one = buildPlan(snap({ labs: [lab("a", { licenceNo: "L", address: "A" })] }), {}, { role: "OWNER" });
    assert.equal(step(one, "lab_licence").status, "done");
    const two = buildPlan(snap({ labs: [lab("a", { licenceNo: "L", address: "A" }), lab("b")] }), {}, { role: "OWNER" });
    const st = step(two, "lab_licence");
    assert.equal(st.status, "pending");
    assert.deepEqual([st.doneCount, st.totalCount], [1, 2]);
    assert.match(st.href, /entity=b$/);
  });
  it("skips are per entity for optional steps; required cannot be skipped", () => {
    const p = buildPlan(snap({ labs: [lab("a"), lab("b")] }), { [skipKey("lab_coverage", "a")]: "skipped", [skipKey("lab_licence", "a")]: "skipped" }, { role: "OWNER" });
    assert.deepEqual(step(p, "lab_coverage").entities!.map((e) => e.status), ["skipped", "pending"]);
    assert.equal(step(p, "lab_licence").entities![0]!.status, "pending");
  });
  it("roles: reception cannot manage the lab and sees who can; connect is hidden for non-managers", () => {
    const p = buildPlan(snap(), {}, { role: "RECEPTION" });
    assert.equal(step(p, "lab_licence").canPerform, false);
    assert.ok(step(p, "lab_licence").whoCan.includes("OWNER"));
    assert.equal(step(p, "first_order").canPerform, true);
    assert.equal(p.steps.some((s) => s.key === "connect_kiorex"), false);
    assert.equal(buildPlan(snap(), {}, { role: "BRANCH_MANAGER" }).steps.some((s) => s.key === "connect_kiorex"), false);
    assert.equal(buildPlan(snap(), {}, { role: "OWNER" }).steps.some((s) => s.key === "connect_kiorex"), true);
  });
  it("all done only when every unit is done/skipped; dismissal only counts then", () => {
    const done = snap({ labs: [lab("a", { licenceNo: "L", address: "A", coverageDistricts: 2 })], testCount: 3, signatoryLicensed: true, otherStaff: 1, safetyContact: true, orderCount: 1, releasedReports: 1, connected: true });
    const p = buildPlan(done, {}, { role: "OWNER" }, "2026-01-01T00:00:00Z");
    assert.equal(p.allDone, true);
    assert.equal(p.dismissedAt, "2026-01-01T00:00:00Z");
    assert.equal(buildPlan(snap(), {}, { role: "OWNER" }, "2026-01-01T00:00:00Z").dismissedAt, null);
  });
});
