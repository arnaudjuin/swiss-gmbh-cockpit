// Port of routes/bank.py list_transactions — live parse of the stored
// statement file (no DB writes; bank_transactions stays reserved).
import fs from "fs";
import path from "path";
import { db, round2 } from "./db";
import { DIRS } from "./files";
import { decodeBytes, parseCamtEntries, parseUbsCsv, extractReason, buildDesc } from "./camt";

export interface TxRow {
  date: string; value_date: string; amount: number; counterparty: string;
  description: string; transaction_no: string; reference: string;
  balance: number | null;
  sub_entries?: { amount: number; counterparty: string; description: string }[];
}

export function listTransactions(id: number):
  | { error: string; transactions: [] }
  | { notFound: true }
  | { source: string | null; period_start: string; period_end: string; opening: number | null;
      closing: number | null; currency: string; count: number; total_in: number;
      total_out: number; net: number; transactions: TxRow[] } {
  const row: any = db().prepare("SELECT * FROM bank_statements WHERE id=?").get(id);
  if (!row) return { notFound: true };
  const txns: TxRow[] = [];
  let source: string | null = null;
  if (row.statement_file_xml) {
    const fp = path.join(DIRS.bank, path.basename(row.statement_file_xml));
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp);
      // Same test as Python: first non-whitespace byte '<' → XML, else UBS CSV.
      let i = 0;
      while (i < raw.length && [0x20, 0x09, 0x0a, 0x0d, 0x0c, 0x0b].includes(raw[i])) i++;
      if (raw[i] === 0x3c) {
        source = "CAMT.053 XML";
        txns.push(...parseCamtEntries(decodeBytes(raw)));
      } else {
        source = "UBS CSV";
        const parsed = parseUbsCsv(decodeBytes(raw));
        if (!("error" in parsed)) {
          for (const tx of parsed.transactions) {
            const cparty = (tx.description1 || "").split(";")[0].trim();
            const label = (tx.description2 || tx.description1 || "").split(";")[0].trim();
            const desc = buildDesc(label, extractReason(tx.description3, tx.description2));
            const base = {
              date: tx.trade_date, value_date: tx.value_date || tx.trade_date,
              amount: tx.amount, transaction_no: tx.transaction_no, reference: "",
              balance: tx.balance,
            };
            if (tx.sub_entries.length) {
              txns.push({ ...base, counterparty: cparty || "(multi-order)", description: desc,
                sub_entries: tx.sub_entries.map(sub => {
                  const subLabel = (sub.description3 || sub.description2 || "").split(";")[0].trim();
                  return { amount: sub.amount,
                    counterparty: (sub.description1 || "").split(";")[0].trim(),
                    description: buildDesc(subLabel, extractReason(sub.description3, sub.description2)) };
                }) });
            } else {
              txns.push({ ...base, counterparty: cparty, description: desc });
            }
          }
        }
      }
    }
  }
  if (!txns.length) {
    return { error: "No machine-readable statement file (XML/CSV) attached, or it could not be parsed",
      transactions: [] };
  }
  const total_in = round2(txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  const total_out = round2(txns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  return {
    source, period_start: row.period_start, period_end: row.period_end,
    opening: row.opening_balance, closing: row.closing_balance,
    currency: row.currency || "CHF", count: txns.length,
    total_in, total_out, net: round2(total_in + total_out), transactions: txns,
  };
}
