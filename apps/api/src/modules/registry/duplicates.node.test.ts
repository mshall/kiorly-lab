import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clusterDuplicates, dupReasons, normName, normPhone } from "./duplicates";

const p = (id: string, fullName: string, d: string | null, phone: string | null, nid: string | null = null) => ({ id, fullName, dateOfBirth: d ? new Date(d) : null, phone, nationalIdHash: nid });

describe("duplicate detection", () => {
  it("normalises Arabic names (diacritics, alef/yaa/taa-marbuta variants)", () => {
    assert.equal(normName("أَحمد  عَلى"), normName("احمد علي"));
    assert.equal(normName("Fatma  EL-Sayed"), "fatma el sayed");
  });
  it("normalises phone numbers by trailing digits", () => {
    assert.equal(normPhone("+20 100 000 0111"), normPhone("01000000111"));
    assert.equal(normPhone("123"), null);
  });
  it("flags national id, phone+dob and name+dob matches, not lookalikes", () => {
    assert.deepEqual(dupReasons(p("a", "X", null, null, "h1"), p("b", "Y", null, null, "h1")), ["NATIONAL_ID"]);
    assert.deepEqual(dupReasons(p("a", "Amira", "1990-05-10", "+201000000111"), p("b", "Amira S", "1990-05-10", "01000000111")), ["PHONE_DOB"]);
    assert.deepEqual(dupReasons(p("a", "Amira Test", "1990-05-10", null), p("b", "amira  test", "1990-05-10", null)), ["NAME_DOB"]);
    assert.deepEqual(dupReasons(p("a", "Amira Test", "1990-05-10", null), p("b", "Amira Test", "1991-05-10", null)), []);
  });
  it("clusters transitively", () => {
    const rows = [p("a", "A", "1990-01-01", "01000000001"), p("b", "B", "1990-01-01", "01000000001", "n"), p("c", "C", null, null, "n"), p("d", "D", "1980-01-01", null)];
    const c = clusterDuplicates(rows);
    assert.equal(c.length, 1);
    assert.deepEqual(c[0]!.members.map((m) => m.id).sort(), ["a", "b", "c"]);
  });
});
