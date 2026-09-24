import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";

export const POST = guard(async (req: NextRequest) => {
  const body = await req.json();
  const results = [];
  for (const row of body.rows ?? []) {
    const amt = Math.abs(row.amount);
    const matches: any[] = [];
    if (row.amount < 0) {
      for (const b of db().prepare(
        `SELECT id, vendor, description, amount, due_date, status FROM company_docs
         WHERE status='unpaid' AND ABS(amount - ?) < 0.5`).all(amt) as any[]) {
        matches.push({ type: "bill", id: b.id, label: b.vendor, amount: b.amount, due: b.due_date });
      }
      for (const o of db().prepare(
        `SELECT id, period_label, obligation_type, amount, due_date FROM obligations
         WHERE status='unpaid' AND ABS(amount - ?) < 0.5`).all(amt) as any[]) {
        matches.push({ type: "obligation", id: o.id,
          label: `${o.obligation_type} ${o.period_label}`, amount: o.amount, due: o.due_date });
      }
    } else {
      for (const i of db().prepare(
        `SELECT id, invoice_number, total, year, month FROM invoices
         WHERE paid_status='unpaid' AND hours > 0 AND ABS(total - ?) < 0.5`).all(amt) as any[]) {
        matches.push({ type: "invoice", id: i.id,
          label: `Invoice #${String(i.invoice_number).padStart(4, "0")}`,
          amount: i.total, due: `${i.year}-${String(i.month).padStart(2, "0")}` });
      }
    }
    results.push({
      csv_row: { date: row.date, description: row.description,
        amount: row.amount, reference: row.reference ?? null },
      matches,
      suggested: matches.length ? matches[0] : null,
    });
  }
  return json({ rows: results, count: results.length });
});
