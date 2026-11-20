/**
 * Safe expression evaluator for calculated tests (no eval). Grammar:
 *   expr   := cmp
 *   cmp    := sum (("<"|">"|"<="|">=") sum)?
 *   sum    := term (("+"|"-") term)*
 *   term   := unary (("*"|"/") unary)*
 *   unary  := "-" unary | pow
 *   pow    := atom ("^" unary)?
 *   atom   := number | ident | ident "(" args ")" | "(" expr ")"
 * Functions: MIN MAX ABS SQRT LN LOG10 ROUND(x[,d]) IF(cond,a,b). Identifiers are analyte codes or the built-ins AGE (years) and MALE (1/0).
 */
type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

export class FormulaError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const num = /^\d+(\.\d+)?([eE][+-]?\d+)?|^\.\d+/.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: "id", v: id[0].toUpperCase() }); i += id[0].length; continue; }
    const op2 = src.slice(i, i + 2);
    if (op2 === "<=" || op2 === ">=") { out.push({ t: "op", v: op2 }); i += 2; continue; }
    if ("+-*/^()<>,".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new FormulaError(`unexpected character "${c}"`);
  }
  return out;
}

type Node = { k: "num"; v: number } | { k: "var"; n: string } | { k: "bin"; op: string; a: Node; b: Node } | { k: "neg"; a: Node } | { k: "call"; fn: string; args: Node[] };
const FUNCS: Record<string, number | [number, number]> = { MIN: [1, 8], MAX: [1, 8], ABS: 1, SQRT: 1, LN: 1, LOG10: 1, ROUND: [1, 2], IF: 3 };

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => { const t = toks[p++]; if (!t || (v && !(t.t === "op" && t.v === v))) throw new FormulaError(v ? `expected "${v}"` : "unexpected end"); return t; };
  const isOp = (...v: string[]) => { const t = peek(); return t?.t === "op" && v.includes(t.v); };
  function cmp(): Node { const a = sum(); if (isOp("<", ">", "<=", ">=")) { const op = (eat() as { v: string }).v; return { k: "bin", op, a, b: sum() }; } return a; }
  function sum(): Node { let a = term(); while (isOp("+", "-")) { const op = (eat() as { v: string }).v; a = { k: "bin", op, a, b: term() }; } return a; }
  function term(): Node { let a = unary(); while (isOp("*", "/")) { const op = (eat() as { v: string }).v; a = { k: "bin", op, a, b: unary() }; } return a; }
  function unary(): Node { if (isOp("-")) { eat(); return { k: "neg", a: unary() }; } return pow(); }
  function pow(): Node { const a = atom(); if (isOp("^")) { eat(); return { k: "bin", op: "^", a, b: unary() }; } return a; }
  function atom(): Node {
    const t = eat();
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "id") {
      if (isOp("(")) {
        eat("(");
        const args: Node[] = [];
        if (!isOp(")")) { args.push(cmp()); while (isOp(",")) { eat(); args.push(cmp()); } }
        eat(")");
        const spec = FUNCS[t.v];
        if (spec === undefined) throw new FormulaError(`unknown function ${t.v}`);
        const [lo, hi] = Array.isArray(spec) ? spec : [spec, spec];
        if (args.length < lo || args.length > hi) throw new FormulaError(`${t.v} takes ${lo === hi ? lo : `${lo}-${hi}`} argument(s)`);
        return { k: "call", fn: t.v, args };
      }
      return { k: "var", n: t.v };
    }
    if (t.v === "(") { const e = cmp(); eat(")"); return e; }
    throw new FormulaError(`unexpected "${t.v}"`);
  }
  const root = cmp();
  if (p !== toks.length) throw new FormulaError("unexpected trailing input");
  return root;
}

export const BUILTINS = ["AGE", "MALE"] as const;

/** Analyte codes a formula reads (built-ins excluded). */
export function formulaInputs(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => { if (n.k === "var") { if (!(BUILTINS as readonly string[]).includes(n.n)) out.add(n.n); } else if (n.k === "bin") { walk(n.a); walk(n.b); } else if (n.k === "neg") walk(n.a); else if (n.k === "call") n.args.forEach(walk); };
  walk(parseFormula(src));
  return [...out];
}

/** Evaluates with the given variables; returns null when the result is not a finite number (missing input, divide by zero, domain error). */
export function evalFormula(src: string, vars: Record<string, number>): number | null {
  const ev = (n: Node): number => {
    switch (n.k) {
      case "num": return n.v;
      case "var": { const v = vars[n.n]; if (v === undefined) throw new FormulaError(`missing ${n.n}`); return v; }
      case "neg": return -ev(n.a);
      case "bin": {
        const a = ev(n.a), b = ev(n.b);
        switch (n.op) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / b; case "^": return a ** b; case "<": return a < b ? 1 : 0; case ">": return a > b ? 1 : 0; case "<=": return a <= b ? 1 : 0; default: return a >= b ? 1 : 0; }
      }
      case "call": {
        const args = n.args.map(ev);
        switch (n.fn) {
          case "MIN": return Math.min(...args); case "MAX": return Math.max(...args); case "ABS": return Math.abs(args[0]!); case "SQRT": return Math.sqrt(args[0]!);
          case "LN": return Math.log(args[0]!); case "LOG10": return Math.log10(args[0]!);
          case "ROUND": { const d = args[1] ?? 0; const m = 10 ** d; return Math.round(args[0]! * m) / m; }
          default: return args[0]! ? args[1]! : args[2]!;
        }
      }
    }
  };
  try {
    const r = ev(parseFormula(src));
    return Number.isFinite(r) ? r : null;
  } catch (e) {
    if (e instanceof FormulaError) return null;
    throw e;
  }
}
