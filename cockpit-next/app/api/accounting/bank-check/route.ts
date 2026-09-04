import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { listTransactions } from "@/server/bankTx";

// Bank outflows matching `amount` ±tol in [doc_date − 5d, doc_date + 35d].
// Asymmetric on purpose: invoices are paid up to ~30 days after their date.
function bankMatches(amount: number, docDate: string, daysBefore = 5, daysAfter = 35, tol = 0.05) {
  const d0 = Date.parse((docDate || "").slice(0, 10));
  if (!Number.isFinite(d0)) return [];
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const lo = iso(d0 - daysBefore * 86400000);
  const hi = iso(d0 + daysAfter * 86400000);
  const stmts: any[] = db().prepare(
    "SELECT id FROM bank_statements WHERE period_end >= ? AND period_start <= ?").all(lo, hi);
  const hits: any[] = [];
  for (const s of stmts) {
    const data = listTransactions(s.id);
    if (!("transactions" in data)) continue;
    for (const tx of data.transactions as any[]) {
      const rows = tx.sub_entries?.length ? tx.sub_entries : [tx];
      for (const t of rows) {
        const amt = Number(t.amount || 0);
        const tdate = ((t.date || tx.date) || "").slice(0, 10);
        if (amt < 0 && Math.abs(Math.abs(amt) - amount) <= tol && lo <= tdate && tdate <= hi) {
          hits.push({ date: tdate, amount: amt,
            counterparty: t.counterparty || tx.counterparty || "", statement_id: s.id });
        }
      }
    }
  }
  return hits;
}

export const GET = guard(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const amount = Number(p.get("amount"));
  const docDate = p.get("doc_date") || "";
  const paidVia = p.get("paid_via") || "personal";
  const hits = bankMatches(amount, docDate);
  let warning: string | null = null;
  if (paidVia === "personal" && hits.length) {
    const h = hits[0];
    warning = `A GmbH bank debit of CHF ${Math.abs(h.amount).toFixed(2)} to ` +
      `'${String(h.counterparty).slice(0, 40)}' on ${h.date} matches this bill — ` +
      `it looks paid from the company account, not privately.`;
  }
  return json({ matches: hits, warning });
});
