// Query-language port (the subset both Next pages use): free text,
// "exact phrase", amounts (1500, >1000, <500, 100-200), dates (YYYY-MM-DD,
// YYYY-MM, YYYY, month names, q1-q4, today/last month/ytd),
// paid/unpaid/overdue, type: filter. AND-combined, like the Python original.
import { db, todayISO, MONTH_NAME } from "./db";

const fmt2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS: Record<string, number> = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,
  august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
const TYPES: Record<string, string> = { invoice:"invoice",invoices:"invoice",inv:"invoice",
  bill:"bill",bills:"bill",doc:"bill",docs:"bill" };

export interface Parsed { kind: string; label: string }
interface Filters {
  text: string[]; phrases: string[]; status: string | null; onlyTypes: string[];
  amountExact: number | null; amountMin: number | null; amountMax: number | null;
  dateExact: string | null; datePrefix: string | null; monthNo: number | null;
  yearNo: number | null; quarter: number | null; numericTokens: string[];
}

export function parseQuery(q: string): { f: Filters; parsed: Parsed[] } {
  const f: Filters = { text: [], phrases: [], status: null, onlyTypes: [],
    amountExact: null, amountMin: null, amountMax: null,
    dateExact: null, datePrefix: null, monthNo: null, yearNo: null, quarter: null, numericTokens: [] };
  const parsed: Parsed[] = [];
  const tokens: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[1] != null) { f.phrases.push(m[1]); parsed.push({ kind: "text", label: `"${m[1]}"` }); }
    else tokens.push(m[2]);
  }
  const dateChips: Parsed[] = [];
  for (const tok of tokens) {
    const t = tok.toLowerCase();
    let mm: RegExpMatchArray | null;
    if ((mm = t.match(/^type:(\w+)$/)) && TYPES[mm[1]]) { f.onlyTypes.push(TYPES[mm[1]]); }
    else if (t === "paid" || t === "unpaid" || t === "overdue") { f.status = t; parsed.push({ kind: "status", label: `status: ${t}` }); }
    else if ((mm = t.match(/^\d{4}-\d{2}-\d{2}$/))) { f.dateExact = t; dateChips.push({ kind: "date", label: t }); }
    else if ((mm = t.match(/^(\d{4})-(\d{2})$/))) { f.datePrefix = t; dateChips.push({ kind: "date", label: t }); }
    else if ((mm = t.match(/^>(\d+(?:\.\d+)?)$/))) { f.amountMin = Number(mm[1]); parsed.push({ kind: "amount", label: `> CHF ${mm[1]}` }); }
    else if ((mm = t.match(/^<(\d+(?:\.\d+)?)$/))) { f.amountMax = Number(mm[1]); parsed.push({ kind: "amount", label: `< CHF ${mm[1]}` }); }
    else if ((mm = t.match(/^(\d+)-(\d+)$/))) { f.amountMin = Number(mm[1]); f.amountMax = Number(mm[2]); parsed.push({ kind: "amount", label: `CHF ${mm[1]} – ${mm[2]}` }); }
    else if ((mm = t.match(/^q([1-4])$/))) { f.quarter = Number(mm[1]); }
    else if (/^(19|20)\d{2}$/.test(t)) { f.yearNo = Number(t); dateChips.push({ kind: "date", label: t }); }
    else if (MONTHS[t]) { f.monthNo = MONTHS[t]; dateChips.push({ kind: "date",
      label: `${f.yearNo ?? new Date().getFullYear()}-${String(MONTHS[t]).padStart(2, "0")}` }); }
    else if (/^\d+(?:\.\d+)?$/.test(t)) { f.amountExact = Number(t); f.numericTokens.push(t); parsed.push({ kind: "amount", label: `≈ CHF ${t} (±5 %)` }); }
    else { f.text.push(t); parsed.push({ kind: "text", label: t }); }
  }
  if (f.quarter) {
    const y = f.yearNo ?? new Date().getFullYear();
    const ms = [0, 1, 2].map(i => `${y}-${String((f.quarter! - 1) * 3 + 1 + i).padStart(2, "0")}`);
    dateChips.push({ kind: "date", label: `Quarter (${ms.join(" / ")})` });
  }
  parsed.push(...dateChips);
  for (const t of f.onlyTypes) parsed.push({ kind: "type", label: `type: ${t}` });
  return { f, parsed };
}

function amountClause(col: string, f: Filters): [string[], unknown[]] {
  const w: string[] = [], a: unknown[] = [];
  if (f.amountExact != null && f.amountMin == null && f.amountMax == null) {
    w.push(`${col} BETWEEN ? AND ?`); a.push(f.amountExact * 0.95, f.amountExact * 1.05);
  }
  if (f.amountMin != null && f.amountExact == null) { w.push(`${col} > ?`); a.push(f.amountMin); }
  if (f.amountMax != null && f.amountExact == null) { w.push(`${col} < ?`); a.push(f.amountMax); }
  if (f.amountMin != null && f.amountMax != null) { w.length = 0; a.length = 0; w.push(`${col} BETWEEN ? AND ?`); a.push(f.amountMin, f.amountMax); }
  return [w, a];
}
function textClause(cols: string[], f: Filters): [string[], unknown[]] {
  const w: string[] = [], a: unknown[] = [];
  for (const t of [...f.text, ...f.phrases]) {
    w.push(`(${cols.map(c => `${c} LIKE ?`).join(" OR ")})`);
    cols.forEach(() => a.push(`%${t}%`));
  }
  return [w, a];
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
function highlight(text: string | null | undefined, tokens: string[]): string {
  if (!text) return "";
  let safe = escapeHtml(String(text));
  for (const tok of tokens) {
    if (!tok || /[<>&"']/.test(tok)) continue;
    safe = safe.replace(new RegExp(`(${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
  }
  return safe;
}

export function search(q: string, limit = 10) {
  if (q.trim().length < 2) return { query: q, results: [], parsed: null };
  const { f, parsed } = parseQuery(q);
  const textTokens = [...f.text, ...f.phrases];
  const d = db();
  const today = todayISO();
  const yr = f.yearNo ?? new Date().getFullYear();
  const results: any[] = [];
  const include = (t: string) => !f.onlyTypes.length || f.onlyTypes.includes(t);

  if (include("invoice")) {
    const w: string[] = ["hours > 0"], a: unknown[] = [];
    const [tw, ta] = textClause(["notes"], f); // free text → notes
    w.push(...tw); a.push(...ta);
    const orParts: string[] = [];
    const [aw, aa] = amountClause("total", f);
    if (aw.length) { orParts.push(aw.join(" AND ")); a.push(...aa); }
    if (f.numericTokens.length) {
      orParts.push("(" + f.numericTokens.map(() => "CAST(invoice_number AS TEXT) LIKE ?").join(" OR ") + ")");
      f.numericTokens.forEach(n => a.push(`%${Number(n)}%`));
    }
    if (orParts.length) w.push("(" + orParts.join(" OR ") + ")");
    if (f.dateExact) { w.push("year = ? AND month = ?"); a.push(Number(f.dateExact.slice(0, 4)), Number(f.dateExact.slice(5, 7))); }
    else if (f.datePrefix) { w.push("year = ? AND month = ?"); a.push(Number(f.datePrefix.slice(0, 4)), Number(f.datePrefix.slice(5, 7))); }
    else if (f.quarter) { w.push("year = ? AND month BETWEEN ? AND ?"); a.push(yr, (f.quarter - 1) * 3 + 1, f.quarter * 3); }
    else if (f.monthNo) { w.push("year = ? AND month = ?"); a.push(yr, f.monthNo); }
    else if (f.yearNo) { w.push("year = ?"); a.push(f.yearNo); }
    if (f.status === "paid") w.push("paid_status = 'paid'");
    else if (f.status === "unpaid") w.push("(paid_status IS NULL OR paid_status = 'unpaid')");
    else if (f.status === "overdue") { w.push("(paid_status IS NULL OR paid_status = 'unpaid') AND due_date < ?"); a.push(today); }
    for (const r of d.prepare(`SELECT id, invoice_number, year, month, total, paid_status FROM invoices WHERE ${w.join(" AND ")} ORDER BY year DESC, month DESC LIMIT ${limit}`).all(...a) as any[]) {
      const title = `Invoice #${String(r.invoice_number).padStart(4, "0")}`;
      const sub = `${MONTH_NAME[r.month]} ${r.year} · CHF ${fmt2(r.total)} · ${r.paid_status ?? "unpaid"}`;
      results.push({ type: "invoice", id: r.id, title, subtitle: sub,
        title_html: highlight(title, textTokens), subtitle_html: highlight(sub, textTokens), page: "invoices" });
    }
  }
  if (include("bill")) {
    const w: string[] = ["1=1"], a: unknown[] = [];
    const [tw, ta] = textClause(["vendor", "description", "category"], f);
    w.push(...tw); a.push(...ta);
    const [aw, aa] = amountClause("amount", f);
    w.push(...aw); a.push(...aa);
    if (f.dateExact) { w.push("doc_date = ?"); a.push(f.dateExact); }
    else if (f.datePrefix) { w.push("substr(doc_date,1,7) = ?"); a.push(f.datePrefix); }
    else if (f.quarter) { w.push("substr(doc_date,1,4) = ? AND CAST(substr(doc_date,6,2) AS INTEGER) BETWEEN ? AND ?"); a.push(String(yr), (f.quarter - 1) * 3 + 1, f.quarter * 3); }
    else if (f.monthNo) { w.push("substr(doc_date,1,4) = ? AND CAST(substr(doc_date,6,2) AS INTEGER) = ?"); a.push(String(yr), f.monthNo); }
    else if (f.yearNo) { w.push("substr(doc_date,1,4) = ?"); a.push(String(f.yearNo)); }
    if (f.status === "overdue") { w.push("status = 'unpaid' AND due_date < ?"); a.push(today); }
    else if (f.status) { w.push("status = ?"); a.push(f.status); }
    for (const r of d.prepare(`SELECT * FROM company_docs WHERE ${w.join(" AND ")} ORDER BY doc_date DESC LIMIT ${limit}`).all(...a) as any[]) {
      const sub = `${r.description} · ${r.currency} ${fmt2(r.amount)} · ${r.status}`;
      results.push({ type: "bill", id: r.id, title: r.vendor, subtitle: sub,
        title_html: highlight(r.vendor, textTokens), subtitle_html: highlight(sub, textTokens), page: "accounting" });
    }
  }
  return { query: q, results, parsed };
}
