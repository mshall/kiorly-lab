import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csvRecords, parseCsv } from "./csv";

describe("CSV parser", () => {
  it("handles quotes, escaped quotes, commas and embedded newlines", () => {
    assert.deepEqual(parseCsv('a,"b,c","say ""hi""",d\r\n1,2,3,4\n'), [["a", "b,c", 'say "hi"', "d"], ["1", "2", "3", "4"]]);
    assert.deepEqual(parseCsv('x,"line1\nline2"\n'), [["x", "line1\nline2"]]);
  });
  it("skips blank lines, strips a BOM, keeps empty cells and Arabic text", () => {
    assert.deepEqual(parseCsv("﻿code,name\n\nA,\n,ب\n"), [["code", "name"], ["A", ""], ["", "ب"]]);
  });
  it("rejects an unterminated quote", () => assert.throws(() => parseCsv('a,"b\n')));
  it("keyed records lower-case the headers", () => {
    const r = csvRecords("Code, Name_EN\nCBC, Complete blood count\n");
    assert.deepEqual(r.headers, ["code", "name_en"]);
    assert.deepEqual(r.records[0], { code: "CBC", name_en: "Complete blood count" });
  });
});
