import assert from "node:assert/strict";
import { test } from "node:test";
import { routeDenied } from "./route-access";

const items = [{ to: "/orders", perm: "orders.read" }, { to: "/settings", perm: "staff.manage" }, { to: "/qc", perm: "qc.read" }];
const reception = (p: string) => p === "orders.read";

test("hidden pages are denied, including detail routes", () => {
  assert.equal(routeDenied("/settings", items, reception), true);
  assert.equal(routeDenied("/qc/run/1", items, reception), true);
});
test("permitted pages, dashboard and unknown paths pass", () => {
  assert.equal(routeDenied("/orders/new", items, reception), false);
  assert.equal(routeDenied("/", items, reception), false);
  assert.equal(routeDenied("/phleb", items, reception), false);
});
