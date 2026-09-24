// Ports of helpers.parse_camt053 / parse_ubs_csv — namespace-agnostic CAMT
// header parsing, UBS semicolon-CSV with multi-order sub-entries.
import { XMLParser } from "fast-xml-parser";

const round2 = (n: number) => Math.round(n * 100) / 100;

type XmlNode = Record<string, unknown>;
function* walk(node: unknown, name?: string): Generator<XmlNode> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n, name); return; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as XmlNode)) {
      const local = k.includes(":") ? k.split(":").pop()! : k;
      if (!name || local === name) {
        if (Array.isArray(v)) for (const x of v) yield x as XmlNode;
        else if (v && typeof v === "object") yield v as XmlNode;
        else yield { "#text": v } as XmlNode;
      }
      yield* walk(v, name);
    }
  }
}
const first = (node: unknown, name: string): XmlNode | null => {
  for (const n of walk(node, name)) return n;
  return null;
};
const textOf = (n: XmlNode | null): string => {
  if (!n) return "";
  const t = (n as any)["#text"];
  return t != null ? String(t) : "";
};

export function parseCamt053(xml: string): Record<string, any> {
  let doc: unknown;
  try {
    doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  } catch (e) {
    return { error: `Invalid XML: ${e}` };
  }
  const stmt = first(doc, "Stmt");
  if (!stmt) return { error: "No <Stmt> element found — not a valid CAMT.053?" };
  const result: Record<string, any> = {};
  const iban = first(stmt, "IBAN");
  if (iban) result.iban = textOf(iban).trim();
  const ccy = first(stmt, "Ccy");
  if (ccy) result.currency = textOf(ccy).trim();
  const frTo = first(stmt, "FrToDt");
  if (frTo) {
    for (const k of ["FrDtTm", "FrDt"]) { const v = textOf(first(frTo, k)); if (v) { result.period_start = v.slice(0, 10); break; } }
    for (const k of ["ToDtTm", "ToDt"]) { const v = textOf(first(frTo, k)); if (v) { result.period_end = v.slice(0, 10); break; } }
  }
  for (const bal of walk(stmt, "Bal")) {
    let code: string | null = null;
    for (const cd of walk(bal, "Cd")) {
      const t = textOf(cd);
      if (["OPBD", "CLBD", "OPAV", "CLAV"].includes(t)) { code = t; break; }
    }
    if (!code) continue;
    const amt = Number(textOf(first(bal, "Amt")));
    if (!Number.isFinite(amt)) continue;
    const sign = textOf(first(bal, "CdtDbtInd")) === "DBIT" ? -1 : 1;
    if ((code === "OPBD" || code === "OPAV") && !("opening_balance" in result)) result.opening_balance = round2(amt * sign);
    else if (code === "CLBD" || code === "CLAV") result.closing_balance = round2(amt * sign);
  }
  result.transaction_count = [...walk(stmt, "Ntry")].length;
  return result;
}

export interface UbsTx {
  trade_date: string; booking_date: string; value_date: string; currency: string;
  amount: number; balance: number | null; transaction_no: string;
  description1: string; description2: string; description3: string;
  sub_entries: { amount: number; description1: string; description2: string; description3: string }[];
}

export function parseUbsCsv(raw: string): { header: Record<string, string>; transactions: UbsTx[] } | { error: string } {
  const text = raw.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const header: Record<string, string> = {};
  let dataIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("Trade date")) { dataIdx = i; break; }
    if (lines[i].includes(";")) {
      const parts = lines[i].split(";").map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const key = parts[0].replace(/:$/, "").trim();
        if (key && parts[1]) header[key] = parts[1];
      }
    }
  }
  if (dataIdx < 0) return { error: "No 'Trade date' header row found — not a UBS transaction CSV?" };
  // Data rows go through csv.DictReader in Python: ';' delimiter, '"' quoting
  // with '""' escapes (descriptions contain semicolons). Multi-line quoted
  // fields don't occur in UBS exports, so splitting per line is safe.
  const splitCsv = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ";") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const cols = splitCsv(lines[dataIdx]).map(c => c.trim());
  const num = (s: string | undefined) => {
    if (!s || !s.trim()) return null;
    const n = Number(s.replace(/'/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const transactions: UbsTx[] = [];
  let current: UbsTx | null = null;
  for (const line of lines.slice(dataIdx + 1)) {
    if (!line.trim()) continue;
    const cells = splitCsv(line);
    const row: Record<string, string> = {};
    cols.forEach((c, i) => { row[c] = (cells[i] ?? "").trim(); });
    const tradeDate = row["Trade date"] ?? "";
    const individual = num(row["Individual amount"]);
    if (!tradeDate && individual != null && current) {
      current.sub_entries.push({ amount: individual,
        description1: row["Description1"] ?? "", description2: row["Description2"] ?? "",
        description3: row["Description3"] ?? "" });
      continue;
    }
    if (!tradeDate) continue;
    const debit = num(row["Debit"]), credit = num(row["Credit"]);
    const amount = debit != null && debit !== 0 ? -Math.abs(debit) : credit != null ? Math.abs(credit) : 0;
    current = { trade_date: tradeDate, booking_date: row["Booking date"] ?? "",
      value_date: row["Value date"] ?? "", currency: row["Currency"] || "CHF",
      amount, balance: num(row["Balance"]), transaction_no: row["Transaction no."] ?? "",
      description1: row["Description1"] ?? "", description2: row["Description2"] ?? "",
      description3: row["Description3"] ?? "", sub_entries: [] };
    transactions.push(current);
  }
  return { header, transactions };
}

// The "Reason for payment" extraction the JSON endpoint applies (bank.py).
export function extractReason(...descriptions: (string | undefined)[]): string {
  let qrr = "", ref = "";
  for (const text of descriptions) {
    for (let seg of (text ?? "").split(";")) {
      seg = seg.trim();
      const low = seg.toLowerCase();
      if (low.startsWith("reason for payment:")) return seg.split(/:(.+)/)[1]?.trim() ?? "";
      if (low.startsWith("reference no. qrr:") && !qrr) qrr = `QR-ref ${seg.split(/:(.+)/)[1]?.trim() ?? ""}`;
      else if (low.startsWith("reference:") && !ref) ref = seg.split(/:(.+)/)[1]?.trim() ?? "";
    }
  }
  return qrr || ref;
}
export const buildDesc = (label: string, reason: string) => (reason || "").trim() || (label || "").trim();


// Python decodes uploads as utf-8-sig and falls back to latin-1.
export function decodeBytes(raw: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw).replace(/^\uFEFF/, "");
  } catch {
    return raw.toString("latin1");
  }
}

// Port of the transactions endpoint's Ntry-level extraction (routes/bank.py).
export function parseCamtEntries(xml: string): {
  date: string; value_date: string; amount: number; counterparty: string;
  description: string; transaction_no: string; reference: string; balance: null;
}[] {
  let doc: unknown;
  try {
    doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  } catch {
    return [];
  }
  const child = (n: XmlNode, name: string): unknown => {
    for (const [k, v] of Object.entries(n)) {
      const local = k.includes(":") ? k.split(":").pop()! : k;
      if (local === name) return Array.isArray(v) ? v[0] : v;
    }
    return undefined;
  };
  const leaf = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "object") { const t = (v as any)["#text"]; return t != null ? String(t) : ""; }
    return String(v);
  };
  const out = [];
  for (const ntry of walk(doc, "Ntry")) {
    let amt = Number(leaf(child(ntry, "Amt")));
    if (!Number.isFinite(amt)) amt = 0;
    if (leaf(child(ntry, "CdtDbtInd")) === "DBIT") amt = -amt;
    const dateOf = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      return (leaf(child(node as XmlNode, "Dt")) || leaf(child(node as XmlNode, "DtTm"))).slice(0, 10);
    };
    let counterparty = "";
    for (const nm of walk(ntry, "Nm")) { const t = leaf(nm); if (t) { counterparty = t; break; } }
    let reference = "";
    for (const r of walk(ntry, "Ref")) { const t = leaf(r); if (t) { reference = t; break; } }
    out.push({
      date: dateOf(child(ntry, "BookgDt")), value_date: dateOf(child(ntry, "ValDt")),
      amount: round2(amt), counterparty, description: "", transaction_no: "",
      reference, balance: null as null,
    });
  }
  return out;
}
