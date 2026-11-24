import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODULES, modulesForRole } from "./mobile-modules";
import { ROLE_PERMISSIONS, SIGNATORY_ROLES } from "../../auth/rbac";
import type { StaffRole } from "../../generated/prisma/client";

/** Bootstrap derivation (MobileService.modulesFor). Demo signatory/director have a licence number, the owner does not. */
const LICENCE: Partial<Record<StaffRole, string>> = { AUTHORIZED_SIGNATORY: "LIC-1", LAB_DIRECTOR: "LIC-2" };
const modulesFor = (role: StaffRole, licence: string | null | undefined = LICENCE[role]) =>
  Object.fromEntries(modulesForRole(role, licence).map((m) => [m.key.replace("lab.", ""), m.enabled ? m.screens : null]));
const on = (role: StaffRole) => Object.entries(modulesFor(role)).filter(([, v]) => v).map(([k]) => k).sort();

/** Pins the Kiorly (staff app) module scoping per Lab role; verified end to end in e2e/test/18-staff-mobile-lab.e2e.ts. */
describe("Kiorly: Lab role -> module scoping", () => {
  it("phlebotomist: collection, label scan, orders only (no results, QC, reagents, validation, TAT, critical)", () => {
    const m = on("PHLEBOTOMIST");
    for (const k of ["phlebotomy", "accession", "orders"]) assert.ok(m.includes(k), k);
    for (const k of ["validation", "worklist", "qc", "reagents", "critical", "tat"]) assert.ok(!m.includes(k), k);
    assert.deepEqual(modulesFor("PHLEBOTOMIST").accession, ["scan", "labels"], "no receive screen without specimens.receive");
    assert.ok(modulesFor("PHLEBOTOMIST").phlebotomy?.includes("round"));
  });
  it("technologist: accessioning (receive), worklist, QC, reagents, tech validation; no collection round, no sign-off", () => {
    const m = on("TECHNOLOGIST");
    for (const k of ["accession", "worklist", "qc", "reagents", "validation"]) assert.ok(m.includes(k), k);
    assert.ok(!m.includes("phlebotomy"));
    assert.ok(modulesFor("TECHNOLOGIST").accession?.includes("receive"));
    assert.ok(modulesFor("TECHNOLOGIST").validation?.includes("tech-validate"));
    assert.ok(!modulesFor("TECHNOLOGIST").validation?.includes("sign-off"));
  });
  it("authorised signatory: validation with sign-off and critical acknowledge; no collection, accessioning or reagents", () => {
    const m = on("AUTHORIZED_SIGNATORY");
    for (const k of ["validation", "critical"]) assert.ok(m.includes(k), k);
    for (const k of ["phlebotomy", "accession", "reagents"]) assert.ok(!m.includes(k), k);
    assert.ok(modulesFor("AUTHORIZED_SIGNATORY").validation?.includes("sign-off"));
    assert.ok(modulesFor("AUTHORIZED_SIGNATORY").critical?.includes("acknowledge"));
  });
  it("reception: orders (+ TAT board, labels); no results, QC, reagents, critical or validation", () => {
    const m = on("RECEPTION");
    assert.ok(m.includes("orders"));
    for (const k of ["validation", "qc", "worklist", "critical", "reagents"]) assert.ok(!m.includes(k), k);
  });
  it("director and owner see every module; only the director (signatory role + licence) gets the sign-off screen, the owner is refused by the API so is not offered it", () => {
    for (const r of ["LAB_DIRECTOR", "OWNER"] as StaffRole[]) assert.equal(on(r).length, MODULES.length, r);
    assert.ok(modulesFor("LAB_DIRECTOR").validation?.includes("sign-off"));
    assert.ok(!modulesFor("OWNER").validation?.includes("sign-off"), "owner has results.medical_validate in RBAC but results.service requires SIGNATORY_ROLES");
    assert.ok(modulesFor("OWNER").validation?.includes("tech-validate"));
    assert.equal(on("SUPERVISOR").length, MODULES.length);
    assert.ok(!modulesFor("SUPERVISOR").validation?.includes("sign-off"));
  });
  it("branch manager: oversight modules (orders, TAT, critical, QC, reagents) but no collection, accessioning or validation", () => {
    const m = on("BRANCH_MANAGER");
    for (const k of ["orders", "tat", "critical", "qc", "reagents"]) assert.ok(m.includes(k), k);
    for (const k of ["phlebotomy", "accession", "validation"]) assert.ok(!m.includes(k), k);
  });
  it("sign-off needs a signatory role AND a recorded licence number (same rule as NOT_AUTHORIZED_SIGNATORY)", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as StaffRole[]) {
      assert.equal(Boolean(modulesFor(role, "LIC-9").validation?.includes("sign-off")), SIGNATORY_ROLES.includes(role) && ROLE_PERMISSIONS[role].includes("results.medical_validate"), role);
      assert.ok(!modulesFor(role, null).validation?.includes("sign-off"), `${role} without licence`);
    }
  });
});

/** GRW-P4-B3: the Growth tab follows the Growth role matrix (growth-access.ts), never a permission. */
describe("Kiorly: lab.growth module per role", () => {
  it("admin roles and read roles get the links screen; bench roles get no Growth module", () => {
    for (const r of ["OWNER", "LAB_DIRECTOR", "BRANCH_MANAGER", "RECEPTION", "SUPERVISOR", "AUTHORIZED_SIGNATORY", "FINANCE"] as const) assert.deepEqual(modulesFor(r).growth, ["links"], r);
    for (const r of ["TECHNOLOGIST", "PHLEBOTOMIST"] as const) assert.equal(modulesFor(r).growth, null, r);
  });
  it("the module never depends on a permission (anyOf is empty)", () => {
    assert.deepEqual(MODULES.find((m) => m.key === "lab.growth")!.anyOf, []);
  });
});
