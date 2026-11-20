/**
 * Minimal QR Code encoder (ISO/IEC 18004): byte mode, error-correction level M, versions 1-6 (up to 106 bytes) -> boolean matrix / SVG.
 * Used for 2D specimen labels (accession + barcode + order). No external dependency.
 */
// [ecCodewordsPerBlock, [blocks, dataCodewordsPerBlock][]] for level M
const M_TABLE: Record<number, [number, [number, number][]]> = {
  1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]], 6: [16, [[4, 27]]],
};
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
export const QR_MAX_BYTES = 106;

const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!; })();
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= gmul(c, EXP[i]!); });
    g = next;
  }
  return g;
}
export function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const res = new Array<number>(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0]!;
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i]! ^= gmul(gen[i + 1]!, factor);
  }
  return res;
}

function dataCodewords(bytes: number[], version: number): number[] {
  const [, groups] = M_TABLE[version]!;
  const capacity = groups.reduce((a, [n, k]) => a + n * k, 0);
  const bits: number[] = [];
  const push = (v: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, 8);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0; out.length < capacity; pad++) out.push(pad % 2 ? 0x11 : 0xec);
  return out;
}

function interleave(data: number[], version: number): number[] {
  const [ecLen, groups] = M_TABLE[version]!;
  const blocks: number[][] = [];
  let pos = 0;
  for (const [n, k] of groups) for (let i = 0; i < n; i++) { blocks.push(data.slice(pos, pos + k)); pos += k; }
  const ecs = blocks.map((b) => rsEncode(b, ecLen));
  const out: number[] = [];
  const maxK = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxK; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]!);
  return out;
}

type Grid = (boolean | null)[][];
function baseMatrix(version: number): { m: Grid; fn: boolean[][] } {
  const n = 17 + 4 * version;
  const m: Grid = Array.from({ length: n }, () => new Array<boolean | null>(n).fill(null));
  const fn = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (r: number, c: number, v: boolean) => { if (r >= 0 && c >= 0 && r < n && c < n) { m[r]![c] = v; fn[r]![c] = true; } };
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const inB = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      set(r0 + r, c0 + c, inB && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[version]!;
  for (const r of al) for (const c of al) {
    if (fn[r]![c]) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  set(n - 8, 8, true); // dark module
  for (let i = 0; i < 9; i++) { if (!fn[8]![i]) { m[8]![i] = false; fn[8]![i] = true; } if (!fn[i]![8]) { m[i]![8] = false; fn[i]![8] = true; } }
  for (let i = 0; i < 8; i++) { if (!fn[8]![n - 1 - i]) { m[8]![n - 1 - i] = false; fn[8]![n - 1 - i] = true; } if (!fn[n - 1 - i]![8]) { m[n - 1 - i]![8] = false; fn[n - 1 - i]![8] = true; } }
  set(n - 8, 8, true);
  return { m, fn };
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
}

function penalty(g: boolean[][]): number {
  const n = g.length;
  let p = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const a = pass ? g[j]![i] : g[i]![j];
        const b = pass ? g[j - 1]![i] : g[i]![j - 1];
        if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
      }
    }
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const v = g[r]![c]; if (v === g[r]![c + 1] && v === g[r + 1]![c] && v === g[r + 1]![c + 1]) p += 3; }
  const pat = [true, false, true, true, true, false, true, false, false, false, false];
  for (let i = 0; i < n; i++) for (let j = 0; j <= n - 11; j++) {
    for (const rev of [false, true]) {
      const q = rev ? [...pat].reverse() : pat;
      if (q.every((v, k) => g[i]![j + k] === v)) p += 40;
      if (q.every((v, k) => g[j + k]![i] === v)) p += 40;
    }
  }
  const dark = g.flat().filter(Boolean).length;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/** Encodes UTF-8 text; returns the module matrix (true = dark). Throws when the payload exceeds QR_MAX_BYTES. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...Buffer.from(text, "utf8")];
  if (bytes.length > QR_MAX_BYTES) throw new RangeError(`QR payload too long (${bytes.length} > ${QR_MAX_BYTES} bytes)`);
  let version = 1;
  while (version < 6 && bytes.length + 2 > M_TABLE[version]![1].reduce((a, [n, k]) => a + n * k, 0)) version++;
  const cw = interleave(dataCodewords(bytes, version), version);
  const { m, fn } = baseMatrix(version);
  const n = m.length;
  const bits: boolean[] = cw.flatMap((b) => Array.from({ length: 8 }, (_, i) => ((b >> (7 - i)) & 1) === 1));
  let bi = 0;
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < n; k++) {
      const r = up ? n - 1 - k : k;
      for (const c of [col, col - 1]) if (!fn[r]![c]) m[r]![c] = bi < bits.length ? bits[bi++]! : false;
    }
    up = !up;
  }
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const g = m.map((row, r) => row.map((v, c) => (fn[r]![c] ? Boolean(v) : Boolean(v) !== MASKS[mask]!(r, c))));
    const fb = formatBits(mask);
    const bit = (i: number) => ((fb >> i) & 1) === 1;
    for (let i = 0; i < 15; i++) {
      const v = bit(i);
      // copy 1 around the top-left finder
      if (i < 6) g[i]![8] = v; else if (i < 8) g[i + 1]![8] = v; else if (i === 8) g[8]![7] = v; else g[8]![14 - i] = v;
      // copy 2: split between top-right and bottom-left
      if (i < 8) g[8]![n - 1 - i] = v; else g[n - 15 + i]![8] = v;
    }
    g[n - 8]![8] = true;
    const s = penalty(g);
    if (s < bestScore) { bestScore = s; best = g; bestMask = mask; }
  }
  void bestMask;
  return best!;
}

/** Scalable SVG (quiet zone 4 modules). */
export function qrSvg(text: string, px = 4): string {
  const g = qrMatrix(text);
  const n = g.length + 8;
  const rects: string[] = [];
  g.forEach((row, r) => { let c = 0; while (c < row.length) { if (!row[c]) { c++; continue; } let e = c; while (e < row.length && row[e]) e++; rects.push(`<rect x="${c + 4}" y="${r + 4}" width="${e - c}" height="1"/>`); c = e; } });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
}
