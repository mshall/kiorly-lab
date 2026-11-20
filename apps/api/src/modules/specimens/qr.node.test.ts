import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QR_MAX_BYTES, qrMatrix, qrSvg, rsEncode } from "./qr";

describe("QR encoder", () => {
  it("Reed-Solomon matches the ISO 18004 annex example (HELLO WORLD v1 ec bytes)", () => {
    // ISO 18004 annex I-style vector: data 32 91 11 120 209 114 220 77 67 64 236 17 236 17 236 17 -> ec (v1-M, 10 codewords)
    const ec = rsEncode([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10);
    assert.deepEqual(ec, [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it("size follows the version and finder patterns are in place", () => {
    const m1 = qrMatrix("KLB|A1");
    assert.equal(m1.length, 21);
    for (const [r, c] of [[0, 0], [0, 14], [14, 0]]) { assert.equal(m1[r]![c], true); assert.equal(m1[r + 3]![c + 3], true); assert.equal(m1[r + 1]![c + 1], false); }
    assert.equal(qrMatrix("x".repeat(40)).length, 17 + 4 * 3);
    assert.equal(qrMatrix("x".repeat(QR_MAX_BYTES)).length, 17 + 4 * 6);
  });
  it("is deterministic, rejects oversize and renders SVG", () => {
    assert.deepEqual(qrMatrix("CAI261120-0001"), qrMatrix("CAI261120-0001"));
    assert.throws(() => qrMatrix("x".repeat(QR_MAX_BYTES + 1)));
    assert.match(qrSvg("hello"), /^<svg[^>]*viewBox="0 0 29 29"/);
  });
});
