import { guard, json } from "@/server/http";
import { db, round2 } from "@/server/db";
import { typeLabel } from "@/server/obligations";

// Port of routes/reports.py::pl_report — accrual P&L, same double-count rules.
export const GET = guard(async (_req, ctx: { params: Promise<{ year: string }> }) => {
  const { year: yearStr } = await ctx.params;
  const year = Number(yearStr);
  const d = db();
  const one = (sql: string, ...a: unknown[]) => (d.prepare(sql).get(...a) as any) ?? {};
  const EXCLUDED = ["Payroll Settlement", "Taxes / VAT"];

  const invoiceRev = one("SELECT COALESCE(SUM(subtotal),0) t FROM invoices WHERE year=? AND hours>0", year).t;
  const invoicePaid = one("SELECT COALESCE(SUM(subtotal),0) t FROM invoices WHERE year=? AND hours>0 AND paid_status='paid'", year).t;
  const extraIncome = one("SELECT COALESCE(SUM(amount),0) t FROM income_entries WHERE substr(income_date,1,4)=? AND invoice_id IS NULL AND category != 'Salary'", String(year)).t;
  const costRows = d.prepare(
    `SELECT category, COUNT(*) cnt, SUM(amount) total FROM company_docs WHERE substr(doc_date,1,4)=? AND category NOT IN (${EXCLUDED.map(() => "?").join(",")}) GROUP BY category ORDER BY total DESC`
  ).all(String(year), ...EXCLUDED) as any[];
  const travel = one("SELECT COALESCE(SUM(amount),0) t, COUNT(*) cnt FROM expenses WHERE substr(expense_date,1,4)=?", String(year));
  const travelReimbursed = one("SELECT COALESCE(SUM(total),0) t FROM invoices WHERE year=? AND hours=0", year).t;
  const obRows = d.prepare(
    "SELECT obligation_type, COUNT(*) cnt, SUM(amount) total, SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) paid FROM obligations WHERE period_year=? GROUP BY obligation_type ORDER BY total DESC"
  ).all(year) as any[];
  const salaryRow = one("SELECT COALESCE(SUM(total_employer_cost),0) t, COUNT(*) n FROM payslips WHERE year=?", year);

  const costCategories = costRows.map(r => ({ category: r.category, count: r.cnt, total: r.total }));
  const obBreakdown = obRows.map(r => ({ type: typeLabel(r.obligation_type), count: r.cnt, total: r.total, paid: r.paid }));
  const totalRevenue = invoiceRev + extraIncome;
  const docsTotal = costCategories.reduce((s, c) => s + c.total, 0);
  const totalCosts = docsTotal + salaryRow.t;
  const pbt = round2(totalRevenue - totalCosts);

  return json({
    year,
    basis: "Accrual, net of VAT. Payroll = issued payslips. Obligations shown for cash planning only (their P&L side already lives in payroll/bills).",
    revenue: { invoices_issued: invoiceRev, invoices_paid: invoicePaid, extra_income: extraIncome, total: totalRevenue },
    costs: { salary: salaryRow.t, payslip_count: salaryRow.n, company_docs: costCategories,
      company_docs_total: docsTotal, excluded_categories: EXCLUDED, total: totalCosts },
    obligations: { breakdown: obBreakdown, total: obBreakdown.reduce((s, o) => s + o.total, 0),
      note: "Cash owed to authorities/insurers — informational, not added to costs." },
    travel_pass_through: { expenses_paid: travel.t ?? 0, expenses_count: travel.cnt ?? 0,
      reimbursed_by_client: travelReimbursed, net_outstanding: (travel.t ?? 0) - travelReimbursed,
      note: "Pass-through: not part of GmbH operating costs. Reimbursed via expense report invoices." },
    profit_before_tax: pbt,
    profit_margin_pct: totalRevenue ? Math.round(pbt / totalRevenue * 1000) / 10 : 0,
  });
});
