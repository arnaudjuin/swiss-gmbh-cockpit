import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, round2 } from "@/server/db";
import { typeLabel } from "@/server/obligations";
import { SALARY } from "@/server/budget";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const p = await ctx.params;
  const year = Number(p.year), quarter = Number(p.quarter);
  if (quarter < 1 || quarter > 4) return err(400, "Quarter 1-4");
  const startMonth = (quarter - 1) * 3 + 1, endMonth = startMonth + 2;
  const months = [startMonth, startMonth + 1, endMonth];

  const invRows: any[] = db().prepare(
    "SELECT * FROM invoices WHERE year=? AND month BETWEEN ? AND ? AND hours>0 ORDER BY month"
  ).all(year, startMonth, endMonth);
  const ps: any = db().prepare(
    `SELECT COALESCE(SUM(gross),0) AS gross, COUNT(*) AS n,
       COALESCE(SUM(emp_ahv),0) AS emp_ahv, COALESCE(SUM(employer_ahv),0) AS employer_ahv
     FROM payslips WHERE year=? AND month BETWEEN ? AND ?`).get(year, startMonth, endMonth);
  const billRows: any[] = db().prepare(
    `SELECT category, COUNT(*) as cnt, SUM(amount) as total FROM company_docs
     WHERE substr(doc_date,1,4)=? AND CAST(substr(doc_date,6,2) AS INTEGER) BETWEEN ? AND ?
     GROUP BY category ORDER BY total DESC`).all(String(year), startMonth, endMonth);
  const obRows: any[] = db().prepare(
    `SELECT obligation_type, COUNT(*) as cnt, SUM(amount) as total FROM obligations
     WHERE substr(due_date,1,4)=? AND CAST(substr(due_date,6,2) AS INTEGER) BETWEEN ? AND ?
     GROUP BY obligation_type`).all(String(year), startMonth, endMonth);

  const invTotal = invRows.reduce((s, r) => s + r.total, 0);
  return json({
    year, quarter,
    period_label: `Q${quarter} ${year}`,
    months,
    invoices: {
      count: invRows.length, total: invTotal,
      items: invRows.map(r => ({ invoice_number: r.invoice_number, month: r.month,
        total: r.total, hours: r.hours })),
    },
    salary: { monthly: SALARY, quarterly_total: ps.gross, payslip_count: ps.n },
    ahv_estimate: {
      employee_rate_pct: 5.3, employer_rate_pct: 5.3,
      employee_contribution: round2(ps.emp_ahv),
      employer_contribution: round2(ps.employer_ahv),
      total: round2(ps.emp_ahv + ps.employer_ahv),
      basis: `exact amounts from ${ps.n} issued payslip(s)`,
    },
    gross_income: invTotal + ps.gross,
    bills_by_category: billRows.map(r => ({ category: r.category, count: r.cnt, total: r.total })),
    bills_total: billRows.reduce((s, r) => s + r.total, 0),
    obligations_by_type: obRows.map(r => ({ type: typeLabel(r.obligation_type), count: r.cnt, total: r.total })),
    obligations_total: obRows.reduce((s, r) => s + r.total, 0),
  });
});
