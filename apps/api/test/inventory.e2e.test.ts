import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, NORMAL, bootApp, call, enterAndTechValidate, makeLab, makeOrder, qcPass, toProcessing } from "./helpers/app";

describe("M6 inventory: items/lots, goods receipt, POs, FEFO auto-deduction per test run, rerun consumption, shortfalls, counts, adjustments, cost per test", () => {
  let t: TestApp;
  let lab: Lab;
  const T = () => lab.tokens;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  before(async () => { t = await bootApp(); lab = await makeLab(t); });
  after(async () => t.close());

  let supplier: any;
  let glu: any;
  let tube: any;

  it("suppliers + items, permissions, duplicate codes", async () => {
    supplier = (await call(t, "POST", "/inventory/suppliers", { token: T().SUPERVISOR, body: { name: "MedSupply Co (synthetic)", leadTimeDays: 5, email: "orders@medsupply.test" } })).body;
    assert.ok(supplier.id);
    assert.equal((await call(t, "POST", "/inventory/suppliers", { token: T().SUPERVISOR, body: { name: "MedSupply Co (synthetic)" } })).status, 409);
    assert.equal((await call(t, "POST", "/inventory/suppliers", { token: T().TECHNOLOGIST, body: { name: "x1" } })).status, 403, "technologists read stock but do not manage it");
    glu = (await call(t, "POST", "/inventory/items", { token: T().SUPERVISOR, body: { code: "rgt-glu", name: "Glucose reagent", unit: "mL", category: "REAGENT", reorderLevel: 20, reorderQty: 100, supplierId: supplier.id } })).body;
    tube = (await call(t, "POST", "/inventory/items", { token: T().SUPERVISOR, body: { code: "TUBE-SST", name: "SST tube", unit: "pcs", category: "CONSUMABLE", reorderLevel: 10, reorderQty: 200, supplierId: supplier.id } })).body;
    assert.equal(glu.code, "RGT-GLU");
    assert.equal((await call(t, "POST", "/inventory/items", { token: T().SUPERVISOR, body: { code: "RGT-GLU", name: "dup" } })).status, 409);
    assert.equal((await call(t, "GET", "/inventory/stock", { token: T().TECHNOLOGIST })).body.length, 2);
    assert.equal((await call(t, "GET", "/inventory/stock", { token: T().PHLEBOTOMIST })).status, 403);
  });

  it("PO -> send -> partial receipt -> full receipt updates lots, weighted average cost and PO status; expired lots refused", async () => {
    const po = await call(t, "POST", "/inventory/purchase-orders", { token: T().SUPERVISOR, body: { supplierId: supplier.id, lines: [{ itemId: glu.id, qty: 100, unitCost: 2 }, { itemId: tube.id, qty: 200, unitCost: 0.5 }] } });
    assert.equal(po.status, 201, JSON.stringify(po.body));
    assert.match(po.body.number, /^PO-\d{4}-\d{6}$/);
    assert.equal(po.body.total, 300);
    const rec0 = await call(t, "POST", "/inventory/receipts", { token: T().SUPERVISOR, body: { poId: po.body.id, lines: [{ itemId: glu.id, lotNumber: "G1", qty: 10, unitCost: 2 }] } });
    assert.equal(rec0.body.code, "PO_NOT_RECEIVABLE", "a draft PO cannot be received");
    assert.equal((await call(t, "POST", `/inventory/purchase-orders/${po.body.id}/send`, { token: T().SUPERVISOR })).body.status, "SENT");
    assert.equal((await call(t, "POST", `/inventory/purchase-orders/${po.body.id}/send`, { token: T().SUPERVISOR })).body.code, "PO_ILLEGAL_TRANSITION");
    assert.equal((await call(t, "POST", "/inventory/receipts", { token: T().SUPERVISOR, body: { poId: po.body.id, lines: [{ itemId: glu.id, lotNumber: "OLD", expiryDate: day(-3), qty: 5, unitCost: 2 }] } })).body.code, "RECEIVING_EXPIRED_LOT");
    const r1 = await call(t, "POST", "/inventory/receipts", { token: T().SUPERVISOR, body: { poId: po.body.id, invoiceRef: "INV-77", lines: [{ itemId: glu.id, lotNumber: "G-LATE", expiryDate: day(300), qty: 40, unitCost: 2 }, { itemId: glu.id, lotNumber: "G-SOON", expiryDate: day(20), qty: 10, unitCost: 3 }] } });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.match(r1.body.number, /^GRN-/);
    let p = await call(t, "GET", `/inventory/purchase-orders/${po.body.id}`, { token: T().TECHNOLOGIST });
    assert.equal(p.body.status, "PARTIAL");
    let st = (await call(t, "GET", "/inventory/stock", { token: T().TECHNOLOGIST })).body.find((x: any) => x.code === "RGT-GLU");
    assert.equal(st.onHand, 50);
    assert.equal(st.expiringLots, 1);
    assert.equal(st.avgUnitCost, 2.2, "(40*2 + 10*3)/50");
    assert.equal(st.low, false);
    await call(t, "POST", "/inventory/receipts", { token: T().SUPERVISOR, body: { poId: po.body.id, lines: [{ itemId: glu.id, lotNumber: "G-LATE", expiryDate: day(300), qty: 50, unitCost: 2 }, { itemId: tube.id, lotNumber: "T1", expiryDate: day(400), qty: 200, unitCost: 0.5 }] } });
    p = await call(t, "GET", `/inventory/purchase-orders/${po.body.id}`, { token: T().TECHNOLOGIST });
    assert.equal(p.body.status, "RECEIVED");
    assert.deepEqual(p.body.lines.map((l: any) => l.qtyReceived).sort(), [100, 200]);
    const lots = await call(t, "GET", `/inventory/items/${glu.id}/lots`, { token: T().TECHNOLOGIST });
    assert.deepEqual(lots.body.map((l: any) => [l.lotNumber, l.qtyOnHand]), [["G-SOON", 10], ["G-LATE", 90]], "earliest expiry first; same lot number merges");
    assert.equal((await call(t, "POST", "/inventory/receipts", { token: T().SUPERVISOR, body: { lines: [{ itemId: glu.id, lotNumber: "X", qty: 1, unitCost: 1 }] } })).body.code, "SUPPLIER_REQUIRED");
  });

  it("running a test auto-deducts reagents FEFO from the right lots (once per item), reruns consume again, shortfalls never block results", async () => {
    const gluTest = (await call(t, "GET", "/catalogue/tests?search=GLU", { token: T().TECHNOLOGIST })).body[0];
    const rule = await call(t, "PUT", `/inventory/consumption-rules/${gluTest.id}`, { token: T().SUPERVISOR, body: { rules: [{ itemId: glu.id, qtyPerTest: 0.5, wastagePercent: 20 }, { itemId: tube.id, qtyPerTest: 1 }] } });
    assert.equal(rule.status, 200, JSON.stringify(rule.body));
    assert.equal(rule.body.length, 2);
    const f = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.bench, ["GLU"]);
    const mv0 = (await call(t, "GET", "/inventory/movements?type=CONSUMPTION", { token: T().SUPERVISOR })).body.length;
    const ids = await enterAndTechValidate(t, lab, f.orderId, { ...NORMAL });
    const mv = (await call(t, "GET", "/inventory/movements?type=CONSUMPTION", { token: T().SUPERVISOR })).body;
    assert.equal(mv.length - mv0, 2, "one consumption movement per rule");
    const lots = (await call(t, "GET", `/inventory/items/${glu.id}/lots`, { token: T().TECHNOLOGIST })).body;
    assert.deepEqual(lots.map((l: any) => [l.lotNumber, l.qtyOnHand]), [["G-SOON", 9.4], ["G-LATE", 90]], "0.5 mL + 20% wastage = 0.6 mL taken from the soonest-expiring lot");
    // a second analyte result on the same item does not consume again; a rerun does
    const before = lots[0].qtyOnHand;
    const rr = await call(t, "POST", `/results/${ids[0]}/rerun`, { token: T().TECHNOLOGIST, body: { reason: "repeat" } });
    assert.equal(rr.status, 201);
    const gluId = lab.analytes.GLU;
    const again = await call(t, "POST", "/results", { token: T().TECHNOLOGIST, body: { orderItemId: f.order.items[0].id, analyteId: gluId, instrumentId: lab.instruments.bench, value: 86 } });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    const after = (await call(t, "GET", `/inventory/items/${glu.id}/lots`, { token: T().TECHNOLOGIST })).body[0];
    assert.equal(after.qtyOnHand, Math.round((before - 0.6) * 10) / 10, "rerun consumed once more");

    // exhaust the stock: shortfall is recorded, the result is still accepted
    for (const l of (await call(t, "GET", `/inventory/items/${glu.id}/lots`, { token: T().TECHNOLOGIST })).body) await call(t, "POST", "/inventory/adjustments", { token: T().SUPERVISOR, body: { lotId: l.id, qty: -l.qtyOnHand, reason: "write-off for test" } });
    const f2 = await makeOrder(t, lab, ["GLU"], { patient: { fullName: "Short Pt", dateOfBirth: "1970-01-01", phone: "+201000009001" } });
    await toProcessing(t, lab, f2);
    const e = await call(t, "POST", "/results", { token: T().TECHNOLOGIST, body: { orderItemId: f2.order.items[0].id, analyteId: gluId, instrumentId: lab.instruments.bench, value: 90 } });
    assert.equal(e.status, 201, "stock-out never blocks a result");
    const short = (await call(t, "GET", "/inventory/movements?itemId=" + glu.id, { token: T().SUPERVISOR })).body.find((m: any) => m.shortfall > 0);
    assert.equal(short.shortfall, 0.6);
    assert.equal(short.lotId, null);
    assert.equal((await call(t, "GET", "/inventory/summary", { token: T().SUPERVISOR })).body.shortfalls30d, 1);
    assert.equal((await call(t, "GET", "/inventory/stock?low=true", { token: T().SUPERVISOR })).body.some((x: any) => x.code === "RGT-GLU"), true);
  });

  it("reorder suggestions account for open POs; adjustments cannot go negative; ledger is append-only", async () => {
    const sug = await call(t, "GET", "/inventory/reorder-suggestions", { token: T().SUPERVISOR });
    const s = sug.body.find((x: any) => x.code === "RGT-GLU");
    assert.equal(s.suggestedQty, 100);
    assert.equal(s.supplier.name, "MedSupply Co (synthetic)");
    assert.equal(s.estimatedCost, 200);
    const po = (await call(t, "POST", "/inventory/purchase-orders", { token: T().SUPERVISOR, body: { supplierId: supplier.id, lines: [{ itemId: glu.id, qty: 100, unitCost: 2 }] } })).body;
    assert.equal((await call(t, "GET", "/inventory/reorder-suggestions", { token: T().SUPERVISOR })).body.some((x: any) => x.code === "RGT-GLU"), false, "already on order");
    assert.equal((await call(t, "POST", `/inventory/purchase-orders/${po.id}/cancel`, { token: T().SUPERVISOR })).body.status, "CANCELLED");
    const lot = (await call(t, "GET", `/inventory/items/${tube.id}/lots`, { token: T().TECHNOLOGIST })).body[0];
    assert.equal((await call(t, "POST", "/inventory/adjustments", { token: T().SUPERVISOR, body: { lotId: lot.id, qty: -9999, reason: "oops" } })).body.code, "NEGATIVE_STOCK");
    assert.equal((await call(t, "POST", "/inventory/adjustments", { token: T().SUPERVISOR, body: { lotId: lot.id, qty: -5, reason: "dropped" } })).body.qtyOnHand, 192, "200 - 3 runs - 5 dropped");
    const mv = await t.prisma.stockMovement.findFirstOrThrow({ where: { orgId: lab.orgId } });
    await assert.rejects(t.prisma.stockMovement.update({ where: { id: mv.id }, data: { memo: "tamper" } }), /append-only/);
    await assert.rejects(t.prisma.stockMovement.delete({ where: { id: mv.id } }), /append-only/);
  });

  it("quarantine stops consumption; expired lots are disposed with value; stock count posts variances", async () => {
    const item = (await call(t, "POST", "/inventory/items", { token: T().SUPERVISOR, body: { code: "CTRL-1", name: "Control serum", unit: "mL", reorderLevel: 1 } })).body;
    const rc = await call(t, "POST", "/inventory/receipts", { token: T().SUPERVISOR, body: { supplierId: supplier.id, lines: [{ itemId: item.id, lotNumber: "C-A", expiryDate: day(60), qty: 10, unitCost: 5 }, { itemId: item.id, lotNumber: "C-B", expiryDate: day(90), qty: 10, unitCost: 5 }] } });
    assert.equal(rc.status, 201);
    const lots = (await call(t, "GET", `/inventory/items/${item.id}/lots`, { token: T().TECHNOLOGIST })).body;
    assert.equal((await call(t, "PUT", `/inventory/lots/${lots[0].id}/status`, { token: T().SUPERVISOR, body: { status: "QUARANTINE" } })).body.status, "QUARANTINE");
    assert.equal((await call(t, "GET", "/inventory/stock?search=CTRL", { token: T().TECHNOLOGIST })).body[0].onHand, 10, "quarantined lot is not usable stock");
    await t.prisma.inventoryLot.update({ where: { id: lots[1].id }, data: { expiryDate: new Date(Date.now() - 5 * 86_400_000) } });
    const d = await call(t, "POST", "/inventory/dispose-expired", { token: T().SUPERVISOR, body: {} });
    assert.deepEqual([d.body.disposed, d.body.value], [1, 50]);
    // stock count
    const cnt = await call(t, "POST", "/inventory/counts", { token: T().SUPERVISOR, body: { note: "monthly" } });
    assert.equal(cnt.status, 201, JSON.stringify(cnt.body));
    assert.match(cnt.body.number, /^CNT-/);
    assert.equal((await call(t, "POST", "/inventory/counts", { token: T().SUPERVISOR, body: {} })).body.code, "COUNT_ALREADY_OPEN");
    const line = cnt.body.lines.find((l: any) => l.item.code === "TUBE-SST");
    await call(t, "PUT", `/inventory/counts/${cnt.body.id}/lines`, { token: T().SUPERVISOR, body: { lines: [{ lotId: line.lotId, countedQty: 190 }] } });
    const done = await call(t, "POST", `/inventory/counts/${cnt.body.id}/complete`, { token: T().SUPERVISOR });
    assert.equal(done.body.status, "COMPLETED");
    assert.equal(done.body.lines.find((l: any) => l.lotId === line.lotId).variance, -2, "192 on hand vs 190 counted");
    const tl = (await call(t, "GET", `/inventory/items/${tube.id}/lots`, { token: T().TECHNOLOGIST })).body[0];
    assert.equal(tl.qtyOnHand, 190);
    assert.ok((await call(t, "GET", "/inventory/movements?type=COUNT_VARIANCE", { token: T().SUPERVISOR })).body.length >= 1);
    assert.equal((await call(t, "POST", `/inventory/counts/${cnt.body.id}/complete`, { token: T().SUPERVISOR })).body.code, "COUNT_COMPLETED");
  });

  it("cost per test: theoretical reagent cost from rules vs price, with margin and actual consumption", async () => {
    const c = await call(t, "GET", "/inventory/cost-per-test", { token: T().SUPERVISOR });
    const g = c.body.find((x: any) => x.code === "GLU");
    assert.equal(g.price, 40);
    assert.equal(g.reagentCost, 1.76, "0.6 mL x avg 2.10 + 1 tube x 0.50");
    assert.equal(g.margin, 38.24);
    assert.equal(g.components.length, 2);
    assert.ok(g.runs >= 1 && g.actualCost > 0);
  });
});
