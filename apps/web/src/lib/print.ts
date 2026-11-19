/** Opens a printable specimen label (Code 128 SVG from the API). Printer/symbology choice is NEEDS_HUMAN (NH-LB-012). */
export function printLabel(l: { svg: string; accessionNumber: string; patientName: string; tests: string[]; specimenType: string; orderNumber?: string }): void {
  const w = window.open("", "_blank", "width=420,height=300");
  if (!w) return;
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  w.document.write(`<!doctype html><title>${esc(l.accessionNumber)}</title><body style="font:12px sans-serif;margin:8px;width:300px"><div style="font-weight:700;font-size:14px">${esc(l.patientName)}</div><div>${esc(l.specimenType)} · ${esc(l.tests.join(", "))}</div>${l.svg}<div style="font-family:monospace;font-size:14px">${esc(l.accessionNumber)}</div><div>${esc(l.orderNumber ?? "")}</div><script>window.onload=()=>{window.print()}</script></body>`);
  w.document.close();
}
