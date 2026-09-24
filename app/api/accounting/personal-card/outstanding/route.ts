import { guard, json } from "@/server/http";
import { db, round2, MONTH_ABBR } from "@/server/db";

export const GET = guard(async () => {
  const bills: any[] = db().prepare(
    `SELECT id, doc_date, vendor, description, amount, currency, category
     FROM company_docs WHERE paid_via='personal' AND reimbursed_at IS NULL
     ORDER BY doc_date`).all();
  const reports: any[] = db().prepare(
    `SELECT id, report_number, year, month, total, expense_count, created_at
     FROM expense_reports WHERE reimbursed_at IS NULL ORDER BY report_number`).all();
  const reps = reports.map(r => ({
    id: r.id, report_number: r.report_number,
    period: r.month ? `${MONTH_ABBR[r.month]} ${r.year}` : String(r.year),
    amount: round2(Number(r.total || 0)), expense_count: r.expense_count,
    created_at: (r.created_at || "").slice(0, 10),
  }));
  return json({ bills, reports: reps,
    total: round2(bills.reduce((s, b) => s + b.amount, 0) + reps.reduce((s, r) => s + r.amount, 0)) });
});
