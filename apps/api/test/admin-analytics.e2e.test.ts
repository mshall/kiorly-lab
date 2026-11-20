import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, PATIENT, bootApp, call, makeLab, makeOrder, releaseOrder } from "./helpers/app";
import { post } from "./helpers/hmac";

describe("M9 admin & analytics: roles matrix, settings, lab hours, audit viewer, units, catalogue CSV import, 20+ reports (CSV/PDF), standalone vs integrated", () => {
  let t: TestApp;
  let lab: Lab;
  const T = () => lab.tokens;
  before(async () => { t = await bootApp(); lab = await makeLab(t, { vat: 14 }); });
  after(async () => t.close());

  it("roles & permissions matrix covers the 9 roles; the role boundaries hold", async () => {
    const m = await call(t, "GET", "/rbac", { token: T().OWNER });
    assert.deepEqual(Object.keys(m.body.roles).sort(), ["AUTHORIZED_SIGNATORY", "BRANCH_MANAGER", "FINANCE", "LAB_DIRECTOR", "OWNER", "PHLEBOTOMIST", "RECEPTION", "SUPERVISOR", "TECHNOLOGIST"]);
    assert.ok(m.body.permissions.includes("inventory.manage") && m.body.permissions.includes("quality.manage"));
    const has = (role: string, p: string) => m.body.roles[role].includes(p);
    // pathologist signs; finance never touches results; supervisor runs the floor but neither signs nor handles money
    assert.ok(has("AUTHORIZED_SIGNATORY", "reports.sign") && has("AUTHORIZED_SIGNATORY", "histo.report"));
    assert.ok(!has("FINANCE", "results.enter") && !has("FINANCE", "results.read") && has("FINANCE", "billing.payment") && has("FINANCE", "expenses.manage"));
    assert.ok(has("SUPERVISOR", "results.tech_validate") && !has("SUPERVISOR", "reports.sign") && !has("SUPERVISOR", "results.medical_validate") && !has("SUPERVISOR", "billing.payment"));
    assert.ok(has("RECEPTION", "queue.manage") && !has("RECEPTION", "results.enter") && !has("RECEPTION", "patients.merge"));
    assert.ok(has("PHLEBOTOMIST", "collection.perform") && !has("PHLEBOTOMIST", "billing.read"));
    assert.ok(has("TECHNOLOGIST", "results.rerun") && !has("TECHNOLOGIST", "inventory.manage") && !has("TECHNOLOGIST", "analytics.read"));
    assert.equal((await call(t, "GET", "/rbac", { token: T().RECEPTION })).status, 403);
    // staff with the new roles
    const s = await call(t, "POST", "/staff", { token: T().OWNER, body: { email: "fin@example.test", displayName: "Fin Officer", role: "FINANCE" } });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal((await call(t, "POST", "/staff", { token: T().OWNER, body: { email: "sup@example.test", displayName: "Shift Sup", role: "SUPERVISOR" } })).status, 201);
    assert.equal((await call(t, "POST", "/staff", { token: T().BRANCH_MANAGER, body: { email: "own@example.test", displayName: "Own", role: "OWNER" } })).status, 403);
  });

  it("settings (integration mode, default language), lab hours/capacity, audit viewer with filters", async () => {
    const st = await call(t, "GET", "/settings", { token: T().BRANCH_MANAGER });
    assert.equal(st.body.integrationMode, "INTEGRATED", "existing tenants keep their behaviour");
    assert.equal(st.body.defaultLocale, "ar");
    const up = await call(t, "PUT", "/settings", { token: T().OWNER, body: { defaultLocale: "en", name: "Renamed Lab" } });
    assert.equal(up.body.defaultLocale, "en");
    assert.equal((await call(t, "GET", "/auth/me", { token: T().OWNER })).body.tenant.defaultLocale, "en");
    const lu = await call(t, "PUT", `/labs/${lab.labId}`, { token: T().OWNER, body: { openingHour: 7, closingHour: 22, appointmentCapacity: 6, address: "12 Nile St" } });
    assert.equal(lu.status, 200, JSON.stringify(lu.body));
    assert.equal(lu.body.closingHour, 22);
    assert.equal((await call(t, "PUT", `/labs/${lab.labId}`, { token: T().OWNER, body: { openingHour: 23 } })).body.code, "OPENING_HOURS_INVALID");
    assert.equal((await call(t, "PUT", `/labs/${lab.labId}`, { token: T().RECEPTION, body: { name: "x1" } })).status, 403);
    const a1 = await call(t, "GET", "/audit-logs?action=settings.update", { token: T().OWNER });
    assert.ok(a1.body.length >= 1 && a1.body.every((x: any) => x.action.includes("settings.update")));
    assert.ok(!JSON.stringify(a1.body).includes("Renamed Lab"), "audit rows carry field names, not values");
    const a2 = await call(t, "GET", `/audit-logs?entityType=Lab&entityId=${lab.labId}&from=2020-01-01&to=2099-01-01`, { token: T().OWNER });
    assert.ok(a2.body.some((x: any) => x.action === "lab.update"));
    assert.equal((await call(t, "GET", "/audit-logs?from=2099-01-01", { token: T().OWNER })).body.length, 0);
    assert.equal((await call(t, "GET", "/audit-logs", { token: T().TECHNOLOGIST })).status, 403);
  });

  it("units of measure: usage list and rename", async () => {
    const u = await call(t, "GET", "/catalogue/units", { token: T().TECHNOLOGIST });
    assert.ok(u.body.find((x: any) => x.unit === "mg/dL").analytes >= 2);
    const r = await call(t, "PUT", "/catalogue/units/rename", { token: T().LAB_DIRECTOR, body: { from: "x10^9/L", to: "10^9/L" } });
    assert.equal(r.body.analytes, 2);
    assert.ok((await call(t, "GET", "/catalogue/units", { token: T().TECHNOLOGIST })).body.some((x: any) => x.unit === "10^9/L"));
    assert.equal((await call(t, "PUT", "/catalogue/units/rename", { token: T().RECEPTION, body: { from: "a", to: "b" } })).status, 403);
  });

  it("catalogue CSV import: template, dry run reports every bad row, apply is all-or-nothing, re-import updates and versions ranges", async () => {
    const tpl = await call(t, "GET", "/catalogue/import-template/analytes", { token: T().LAB_DIRECTOR });
    assert.match(tpl.body, /^code,name_en,name_ar,unit/);
    const bad = "code,name_en,name_ar,unit,precision,value_type,allowed_values,normal_values,formula,ref_low,ref_high,ref_low_m,ref_high_m,ref_low_f,ref_high_f,critical_low,critical_high\r\n" +
      "FER,Ferritin,الفيريتين,ng/mL,0,NUMERIC,,,,15,150,,,,,,\r\n" +
      "BAD CODE,x,,,,,,,,,,,,,,,\r\n" +
      "CHO1,Choice,,,,CHOICE,,,,,,,,,,,\r\n" +
      "RNG,Range,,mg,1,NUMERIC,,,,10,5,,,,,,\r\n" +
      "CALC,Calc,,,0,NUMERIC,,,NOPE + FER,,,,,,,,\r\n" +
      "FER,Dup,,,,,,,,,,,,,,,\r\n";
    const dry = await call(t, "POST", "/catalogue/import", { token: T().LAB_DIRECTOR, body: { kind: "analytes", csv: bad } });
    assert.equal(dry.status, 201, JSON.stringify(dry.body));
    assert.equal(dry.body.dryRun, true);
    assert.equal(dry.body.applied, false);
    const fields = dry.body.errors.map((e: any) => `${e.row}:${e.field}`).sort();
    assert.deepEqual(fields, ["3:code", "4:allowed_values", "5:ref_low", "6:formula", "7:code"].sort());
    const refuse = await call(t, "POST", "/catalogue/import", { token: T().LAB_DIRECTOR, body: { kind: "analytes", csv: bad, dryRun: false } });
    assert.equal(refuse.status, 422);
    assert.equal(refuse.body.code, "IMPORT_INVALID");
    assert.equal((await t.prisma.analyte.count({ where: { orgId: lab.orgId, code: "FER" } })), 0, "nothing applied when any row is invalid");
    assert.equal((await call(t, "POST", "/catalogue/import", { token: T().LAB_DIRECTOR, body: { kind: "analytes", csv: "foo,bar\n1,2\n" } })).body.code, "CSV_HEADERS_MISSING");
    assert.equal((await call(t, "POST", "/catalogue/import", { token: T().RECEPTION, body: { kind: "analytes", csv: bad } })).status, 403);

    const good = "code,name_en,name_ar,unit,precision,value_type,allowed_values,normal_values,formula,ref_low,ref_high,ref_low_m,ref_high_m,ref_low_f,ref_high_f,critical_low,critical_high\r\n" +
      "FER,Ferritin,الفيريتين,ng/mL,0,NUMERIC,,,,15,150,30,400,13,150,5,\r\n" +
      "TIBC,TIBC,,ug/dL,0,NUMERIC,,,,250,450,,,,,,\r\n" +
      "SAT,Transferrin saturation,,%,0,NUMERIC,,,FER / TIBC * 100,,,,,,,,\r\n" +
      "UCOL,Urine colour,,,,CHOICE,Yellow|Dark|Red,Yellow,,,,,,,,,\r\n";
    const ap = await call(t, "POST", "/catalogue/import", { token: T().LAB_DIRECTOR, body: { kind: "analytes", csv: good, dryRun: false } });
    assert.equal(ap.status, 201, JSON.stringify(ap.body));
    assert.deepEqual([ap.body.applied, ap.body.created, ap.body.updated], [true, 4, 0]);
    const fer = (await call(t, "GET", "/catalogue/analytes", { token: T().TECHNOLOGIST })).body.find((a: any) => a.code === "FER");
    assert.equal(fer.nameAr, "الفيريتين");
    const sat = (await call(t, "GET", "/catalogue/analytes", { token: T().TECHNOLOGIST })).body.find((a: any) => a.code === "SAT");
    assert.equal(sat.formula, "FER / TIBC * 100");
    assert.equal((await call(t, "GET", "/catalogue/analytes", { token: T().TECHNOLOGIST })).body.find((a: any) => a.code === "UCOL").normalValues[0], "Yellow");
    const ranges = await call(t, "GET", `/catalogue/analytes/${fer.id}/reference-intervals`, { token: T().TECHNOLOGIST });
    assert.equal(ranges.body.length, 3);
    // re-import with a changed female range: updates, new version, unchanged rows keep theirs
    const again = good.replace("13,150,5,", "12,150,5,");
    const up = await call(t, "POST", "/catalogue/import", { token: T().LAB_DIRECTOR, body: { kind: "analytes", csv: again, dryRun: false } });
    assert.deepEqual([up.body.created, up.body.updated], [0, 4]);
    const r2 = (await call(t, "GET", `/catalogue/analytes/${fer.id}/reference-intervals`, { token: T().TECHNOLOGIST })).body;
    assert.equal(r2.length, 4, "one new interval version only");
    assert.equal(r2.filter((r: any) => r.sex === "F" && r.effectiveTo === null)[0].low, 12);

    const testsCsv = "code,name_en,name_ar,section,specimen_type,container,volume_ml,fasting,tat_minutes,price,send_out,analytes\r\nIRON,Iron studies,دراسة الحديد,CHEMISTRY,Serum,Serum gel (yellow),3,yes,240,210,false,FER|TIBC|SAT\r\nBADT,x,,NOWHERE,,,,,,abc,,NOPE\r\n";
    const td = await call(t, "POST", "/catalogue/import", { token: T().LAB_DIRECTOR, body: { kind: "tests", csv: testsCsv } });
    assert.deepEqual(td.body.errors.map((e: any) => `${e.row}:${e.field}`).sort(), ["3:analytes", "3:price", "3:section", "3:specimen_type"].sort());
    const tg = await call(t, "POST", "/catalogue/import", { token: T().LAB_DIRECTOR, body: { kind: "tests", csv: testsCsv.split("\r\n").slice(0, 2).join("\r\n") + "\r\n", dryRun: false } });
    assert.equal(tg.status, 201, JSON.stringify(tg.body));
    const iron = (await call(t, "GET", "/catalogue/tests?search=IRON", { token: T().RECEPTION })).body[0];
    assert.deepEqual([iron.section, iron.fastingRequired, iron.price, iron.analytes.length], ["CHEMISTRY", true, 210, 3]);
    assert.equal((await makeOrder(t, lab, ["IRON"], { patient: { ...PATIENT, fullName: "Import Pt", phone: "+201000009901" } })).order.items[0].price, 210, "imported test is orderable at the imported price");
  });

  it("standalone mode: integration endpoints refuse, no outbox events are produced, the lab keeps working; integrated mode behaves as before", async () => {
    const kx = (await call(t, "POST", "/integration-clients", { token: T().OWNER, body: { source: "KIOREX_BOOKING" } })).body;
    const body = { sourceRef: "kx_mode_1", patient: { fullName: "Mode Pt", phone: "+201000009902", dateOfBirth: "1988-03-03", externalId: "sub_mode", sex: "M" }, testCodes: ["CBC"], consentChannels: ["KIOREX_VAULT"] };
    assert.equal((await post(t, kx, "/integration/v1/orders", body)).status, 200, "integrated: accepted");
    const before = await t.prisma.outboxEvent.count({ where: { orgId: lab.orgId } });
    assert.ok(before >= 1);
    assert.equal((await call(t, "PUT", "/settings", { token: T().OWNER, body: { integrationMode: "STANDALONE" } })).body.integrationMode, "STANDALONE");
    const refused = await post(t, kx, "/integration/v1/orders", { ...body, sourceRef: "kx_mode_2" });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, "INTEGRATION_DISABLED");
    assert.equal(await t.prisma.labOrder.count({ where: { orgId: lab.orgId, sourceRef: "kx_mode_2" } }), 0);
    // the whole lab flow works, with no external traffic
    const f = await makeOrder(t, lab, ["GLU"], { patient: { ...PATIENT, fullName: "Standalone Pt", phone: "+201000009903" } });
    await releaseOrder(t, lab, f);
    assert.equal(await t.prisma.outboxEvent.count({ where: { orgId: lab.orgId } }), before, "no outbox events while standalone");
    assert.equal((await call(t, "GET", `/orders/${f.orderId}`, { token: T().RECEPTION })).body.status, "RELEASED");
    // back to integrated: partner traffic flows again
    await call(t, "PUT", "/settings", { token: T().OWNER, body: { integrationMode: "INTEGRATED" } });
    assert.equal((await post(t, kx, "/integration/v1/orders", { ...body, sourceRef: "kx_mode_3" })).status, 200);
  });

  it("onboarding creates standalone tenants by default", async () => {
    const o = await call(t, "POST", "/onboarding/tenants", { body: { name: "Fresh Lab", slug: `fresh-${Date.now().toString(36)}`, labName: "Fresh", labCode: "FRS", ownerName: "Owner", ownerEmail: "o@fresh.test", loadStarterCatalogue: true } });
    assert.equal(o.status, 201, JSON.stringify(o.body));
    const me = await call(t, "GET", "/auth/me", { token: o.body.token });
    assert.equal(me.body.tenant.integrationMode, "STANDALONE");
  });

  it("report library: 20+ reports run for the owner, respect permissions, and export to CSV and PDF", async () => {
    // generate a little of everything
    const ref = (await call(t, "POST", "/referrers", { token: T().BRANCH_MANAGER, body: { name: "Dr Stats", commissionType: "PERCENT", commissionValue: 5 } })).body;
    const f1 = await makeOrder(t, lab, ["CBC", "GLU"], { referrerId: ref.id, patient: { ...PATIENT, fullName: "Stats One", phone: "+201000009911", sex: "F" } });
    await releaseOrder(t, lab, f1, { values: { GLU: 150 } });
    await call(t, "POST", `/orders/${f1.orderId}/invoice`, { token: T().FINANCE, body: { discountPercent: 5, reason: "stats" } });
    await call(t, "POST", "/expenses", { token: T().FINANCE, body: { date: new Date().toISOString().slice(0, 10), category: "UTILITIES", amount: 300 } });
    const rej = await makeOrder(t, lab, ["GLU"], { patient: { ...PATIENT, fullName: "Stats Two", phone: "+201000009912" } });
    await call(t, "POST", `/specimens/${rej.specimens[0].id}/collect`, { token: T().RECEPTION, body: { scannedBarcode: rej.specimens[0].barcode } });
    await call(t, "POST", `/specimens/${rej.specimens[0].id}/receive`, { token: T().TECHNOLOGIST, body: { scannedBarcode: rej.specimens[0].barcode } });
    await call(t, "POST", `/specimens/${rej.specimens[0].id}/reject`, { token: T().TECHNOLOGIST, body: { reason: "HAEMOLYSED" } });

    const list = await call(t, "GET", "/analytics/reports", { token: T().OWNER });
    assert.ok(list.body.length >= 20, `have ${list.body.length} reports`);
    assert.ok(list.body.every((r: any) => r.columns.length && r.title && r.titleAr));
    for (const r of list.body) {
      const res = await call(t, "GET", `/analytics/reports/${r.kind}`, { token: T().OWNER });
      assert.equal(res.status, 200, `${r.kind}: ${JSON.stringify(res.body)}`);
      assert.ok(Array.isArray(res.body.rows), r.kind);
      const csv = await call(t, "GET", `/analytics/reports/${r.kind}.csv`, { token: T().OWNER });
      assert.equal(csv.status, 200, r.kind);
      assert.equal(csv.body.split("\r\n")[0], r.columns.map((c: any) => c.key).join(","), r.kind);
      const pdf = await call(t, "GET", `/analytics/reports/${r.kind}.pdf`, { token: T().OWNER });
      assert.equal(pdf.raw.subarray(0, 5).toString(), "%PDF-", r.kind);
    }
    const q = (kind: string) => call(t, "GET", `/analytics/reports/${kind}`, { token: T().OWNER }).then((x) => x.body);
    const vol = await q("volume-by-day");
    assert.equal(vol.totals.orders, await t.prisma.labOrder.count({ where: { orgId: lab.orgId, status: { not: "CANCELLED" } } }));
    const pos = await q("positivity-by-analyte");
    assert.ok(pos.rows.find((r: any) => r.analyte === "GLU").abnormal >= 1, "glucose 150 is abnormal");
    const rate = await q("rejection-rate");
    assert.equal(rate.rows[0].reason, "HAEMOLYSED");
    const rbr = await q("revenue-by-referrer");
    assert.equal(rbr.rows[0].referrer, "Dr Stats");
    assert.equal(rbr.rows[0].commission, Math.round(rbr.rows[0].net * 0.05 * 100) / 100);
    const exp = await q("expenses-by-category");
    assert.equal(exp.rows[0].amount, 300);
    const rt = await q("revenue-by-test");
    assert.ok(rt.totals.discount > 0 && rt.totals.net < rt.totals.gross);
    const tat = await q("tat-by-section");
    assert.ok(tat.rows.length >= 1);
    const wl = await q("workload-by-technologist");
    assert.ok(wl.rows.some((r: any) => r.entered >= 1));
    // permissions: supervisors see operational reports but not financial ones; technologists get nothing
    const sup = await call(t, "GET", "/analytics/reports", { token: T().SUPERVISOR });
    assert.ok(sup.body.length >= 10 && sup.body.length < list.body.length);
    assert.ok(!sup.body.some((r: any) => r.group === "finance"));
    assert.equal((await call(t, "GET", "/analytics/reports/revenue-by-test", { token: T().SUPERVISOR })).status, 400);
    assert.equal((await call(t, "GET", "/analytics/reports/volume-by-day", { token: T().TECHNOLOGIST })).status, 403);
    assert.equal((await call(t, "GET", "/analytics/reports/volume-by-day", { token: T().FINANCE })).status, 200);
    assert.equal((await call(t, "GET", "/analytics/reports/nope", { token: T().OWNER })).body.code, "UNKNOWN_REPORT");
    assert.equal((await call(t, "GET", "/analytics/reports/volume-by-day?from=2026-02-01&to=2026-01-01", { token: T().OWNER })).body.code, "PERIOD_INVALID");
  });
});
