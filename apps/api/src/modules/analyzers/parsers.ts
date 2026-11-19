/**
 * Parsers for ASTM E1394 and HL7 v2 (ORU^R01) analyzer messages (KLQC01). Pure functions, fixture-tested.
 * Interface details of the first two real analyzer models are NEEDS_HUMAN (NH-LB-010); this implements the standard records.
 */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export interface ParsedObservation {
  testCode: string;
  testName?: string;
  value?: number;
  valueText?: string;
  unit?: string;
  referenceRange?: string;
  abnormalFlag?: string;
  status?: string;
  observedAt?: Date;
}
export interface ParsedGroup {
  specimenId: string;
  isQc: boolean;
  qc?: { level?: string; lot?: string };
  patientId?: string;
  observations: ParsedObservation[];
}
export interface ParsedMessage {
  protocol: "ASTM_E1394" | "HL7_V2";
  messageId?: string;
  sender?: string;
  groups: ParsedGroup[];
  warnings: string[];
}

const num = (s: string | undefined): number | undefined => {
  if (s == null || s.trim() === "") return undefined;
  const n = Number(s.trim().replace(",", "."));
  return Number.isFinite(n) && /^[+-]?\d*\.?\d+(e[+-]?\d+)?$/i.test(s.trim().replace(",", ".")) ? n : undefined;
};

/** ASTM/HL7 timestamp YYYYMMDD[HHMM[SS]] (UTC assumed; analyzers' timezone handling is a go-live item). */
export function parseTs(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(s.trim());
  if (!m) return undefined;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
}

// ------------------------------------------------------------------ ASTM E1394

const STX = "\x02";
const ETX = "\x03";
const ETB = "\x17";
const CTRL = /[\x05\x04\x06\x15\x0a]/g; // ENQ EOT ACK NAK LF

/** Strips low-level framing (STX, frame number, ETX/ETB, checksum, CR/LF) and returns the logical records. */
export function astmRecords(raw: string): string[] {
  const out: string[] = [];
  const frames = raw.includes(STX) ? raw.split(STX).slice(1) : [raw];
  let carry = "";
  for (let f of frames) {
    const end = Math.max(f.indexOf(ETX), f.indexOf(ETB));
    const continued = f.includes(ETB);
    if (end >= 0) f = f.slice(0, end);
    if (raw.includes(STX) && /^\d/.test(f)) f = f.slice(1); // frame number
    f = f.replace(CTRL, "");
    const parts = (carry + f).split("\r").filter((x) => x.length > 0);
    if (continued) carry = parts.pop() ?? "";
    else carry = "";
    out.push(...parts);
  }
  if (carry) out.push(carry);
  return out;
}

export function parseAstm(raw: string): ParsedMessage {
  const records = astmRecords(raw);
  const header = records.find((r) => r.startsWith("H"));
  if (!header) throw new ParseError("ASTM: missing H (header) record");
  const fieldDelim = header[1] ?? "|";
  const compDelim = header[3] ?? "^";
  const unesc = (s: string) => s.replace(/&F&/g, "|").replace(/&S&/g, "^").replace(/&T&/g, "&");
  const split = (r: string) => r.split(fieldDelim);
  const hf = split(header);
  const msg: ParsedMessage = { protocol: "ASTM_E1394", sender: hf[4]?.split(compDelim)[0], messageId: hf[2] || (hf[13] ? `astm-${hf[13]}` : undefined), groups: [], warnings: [] };
  let patientId: string | undefined;
  let cur: ParsedGroup | null = null;
  let seenTerminator = false;
  for (const rec of records) {
    const f = split(rec);
    switch (f[0]) {
      case "P": {
        patientId = f[3] || f[2] || undefined;
        break;
      }
      case "O": {
        const spec = (f[2] ?? "").split(compDelim);
        const id = unesc(spec[0] || f[3] || "");
        const isQc = f[11] === "Q" || id.toUpperCase() === "QC";
        cur = { specimenId: isQc ? "" : id, isQc, patientId, observations: [] };
        if (isQc) cur.qc = { level: spec[1] || undefined, lot: spec[2] || undefined };
        if (!isQc && !id) msg.warnings.push("O record without specimen id");
        msg.groups.push(cur);
        break;
      }
      case "R": {
        if (!cur) {
          msg.warnings.push("R record before any O record ignored");
          break;
        }
        const test = (f[2] ?? "").split(compDelim);
        const code = unesc(test[3] || test[0] || "").trim();
        if (!code) {
          msg.warnings.push("R record without test id ignored");
          break;
        }
        const v = f[3] ?? "";
        cur.observations.push({
          testCode: code, testName: test[4] || undefined, value: num(v), valueText: num(v) === undefined && v ? unesc(v) : undefined, unit: f[4] || undefined,
          referenceRange: f[5] || undefined, abnormalFlag: f[6] || undefined, status: f[8] || undefined, observedAt: parseTs(f[12] || f[11]),
        });
        break;
      }
      case "L":
        seenTerminator = true;
        break;
      default:
        break; // C, M, Q, H: not needed
    }
  }
  if (!seenTerminator) msg.warnings.push("missing L (terminator) record");
  return msg;
}

// ---------------------------------------------------------------------- HL7 v2

const HL7_ESC: Record<string, string> = { F: "|", S: "^", R: "~", E: "\\", T: "&" };
const hl7Unesc = (s: string) => s.replace(/\\([FSRET])\\/g, (_m, c: string) => HL7_ESC[c]);

/** Removes MLLP framing and splits into segments. */
export function hl7Segments(raw: string): string[] {
  return raw.replace(/\x0b/g, "").replace(/\x1c/g, "").split(/\r\n|\r|\n/).map((s) => s.trim()).filter(Boolean);
}

export function parseHl7Oru(raw: string): ParsedMessage {
  const segs = hl7Segments(raw);
  const msh = segs.find((s) => s.startsWith("MSH"));
  if (!msh) throw new ParseError("HL7: missing MSH segment");
  const fieldDelim = msh[3] ?? "|";
  const comp = msh[4] ?? "^";
  const f = msh.split(fieldDelim);
  // MSH-1 is the delimiter itself, so msh.split gives MSH at [0], encoding chars at [1], sender app at [2] ...
  const type = (f[8] ?? "").split(comp);
  if (type[0] !== "ORU") throw new ParseError(`HL7: unsupported message type ${f[8] ?? "(none)"}; expected ORU^R01`);
  const out: ParsedMessage = { protocol: "HL7_V2", messageId: f[9] || undefined, sender: f[2] || undefined, groups: [], warnings: [] };
  let patientId: string | undefined;
  let cur: ParsedGroup | null = null;
  for (const seg of segs) {
    const s = seg.split(fieldDelim);
    switch (s[0]) {
      case "PID":
        patientId = s[3]?.split(comp)[0] || undefined;
        break;
      case "OBR": {
        const filler = s[3]?.split(comp)[0] || s[2]?.split(comp)[0] || "";
        const isQc = s[11] === "Q" || filler.toUpperCase() === "QC";
        cur = { specimenId: isQc ? "" : filler, isQc, patientId, observations: [] };
        if (isQc) cur.qc = { level: s[3]?.split(comp)[1] || undefined, lot: s[3]?.split(comp)[2] || undefined };
        if (!isQc && !filler) out.warnings.push("OBR without specimen id");
        out.groups.push(cur);
        break;
      }
      case "OBX": {
        if (!cur) {
          out.warnings.push("OBX before any OBR ignored");
          break;
        }
        const id = (s[3] ?? "").split(comp);
        const code = hl7Unesc(id[0] ?? "").trim();
        if (!code) {
          out.warnings.push("OBX without observation id ignored");
          break;
        }
        const t = s[2];
        const v = s[5] ?? "";
        const n = t === "NM" || t === "SN" ? num(v.replace(/^[<>=]+/, "")) : undefined;
        cur.observations.push({
          testCode: code, testName: id[1] ? hl7Unesc(id[1]) : undefined, value: n, valueText: n === undefined && v ? hl7Unesc(v) : undefined, unit: s[6]?.split(comp)[0] || undefined,
          referenceRange: s[7] || undefined, abnormalFlag: s[8] || undefined, status: s[11] || undefined, observedAt: parseTs(s[14]),
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** HL7 ACK (AA = accepted, AE = error). */
export function buildHl7Ack(original: string, ok: boolean, text = ""): string {
  const msh = hl7Segments(original).find((s) => s.startsWith("MSH")) ?? "MSH|^~\\&";
  const f = msh.split("|");
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `MSH|^~\\&|KIORLY-LAB|LAB|${f[2] ?? ""}|${f[3] ?? ""}|${ts}||ACK^R01|ACK${f[9] ?? ""}|P|2.5\rMSA|${ok ? "AA" : "AE"}|${f[9] ?? ""}|${text}\r`;
}

export function parseAnalyzerMessage(protocol: "ASTM_E1394" | "HL7_V2", raw: string): ParsedMessage {
  return protocol === "ASTM_E1394" ? parseAstm(raw) : parseHl7Oru(raw);
}
