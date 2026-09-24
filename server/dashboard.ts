// Port of routes/dashboard.py::dashboard_overview — same lens rules:
// accrual revenue (subtotals net of VAT + non-invoice income), costs =
// bills (excl. settlement/VAT categories) + issued payslips, obligations on
// their PAYABLE date, Kontokorrent via the shared formula.
import { db, round2, todayISO, MONTH_ABBR, MONTH_NAME } from "./db";
import { PAYABLE_SQL, typeLabel } from "./obligations";
import { kontokorrentBalance } from "./kontokorrent";

function resolveRange(key: string): { start: string; end: string; label: string } {
  const t = new Date(); const iso = (d: Date) => d.toISOString().slice(0, 10);
  const y = t.getFullYear();
  const day = (n: number) => iso(new Date(t.getTime() - n * 86400000));
  switch (key) {
    case "month": return { start: `${y}-${String(t.getMonth() + 1).padStart(2, "0")}-01`, end: iso(t), label: "This month" };
    case "30d": return { start: day(30), end: iso(t), label: "Last 30 days" };
    case "12m": return { start: day(365), end: iso(t), label: "Last 12 months" };
    case "year": return { start: `${y}-01-01`, end: `${y}-12-31`, label: `Year ${y}` };
    case "prev_year": return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31`, label: `Year ${y - 1}` };
    case "all": return { start: "1970-01-01", end: iso(t), label: "All time" };
    default: return { start: `${y}-01-01`, end: iso(t), label: "Year to date" };
  }
}

export function dashboardOverview(rangeKey = "ytd") {
  const d = db();
  const today = todayISO();
  const now = new Date();
  const year = now.getFullYear();
  const { start, end, label } = resolveRange(rangeKey);
  const invMin = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7));
  const invMax = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
  const yearsInRange: number[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) yearsInRange.push(y);
  const one = (sql: string, ...a: unknown[]) => (d.prepare(sql).get(...a) as any) ?? {};

  const invStats = one("SELECT COUNT(*) cnt, COALESCE(SUM(total),0) rev, COALESCE(SUM(hours),0) hrs FROM invoices WHERE hours>0");
  const invStatsR = one("SELECT COUNT(*) cnt, COALESCE(SUM(total),0) rev, COALESCE(SUM(hours),0) hrs FROM invoices WHERE hours>0 AND (year*12+month) BETWEEN ? AND ?", invMin, invMax);
  const invPaidR = one("SELECT COALESCE(SUM(total),0) t FROM invoices WHERE hours>0 AND paid_status='paid' AND (year*12+month) BETWEEN ? AND ?", invMin, invMax).t;
  const monthlyInv = d.prepare("SELECT year, month, SUM(total) revenue, SUM(hours) hours FROM invoices WHERE hours>0 GROUP BY year, month ORDER BY year, month").all() as any[];
  const cashReceived = one("SELECT COALESCE(SUM(amount),0) t FROM income_entries WHERE income_date BETWEEN ? AND ?", start, end).t;
  const invNet = one("SELECT COALESCE(SUM(subtotal),0) t FROM invoices WHERE hours>0 AND (year*12+month) BETWEEN ? AND ?", invMin, invMax).t;
  const otherIncome = one("SELECT COALESCE(SUM(amount),0) t FROM income_entries WHERE invoice_id IS NULL AND income_date BETWEEN ? AND ?", start, end).t;
  const billsR = one("SELECT COALESCE(SUM(amount),0) t FROM company_docs WHERE doc_date BETWEEN ? AND ? AND category NOT IN ('Payroll Settlement', 'Taxes / VAT')", start, end).t;
  const billsPaidR = one("SELECT COALESCE(SUM(amount),0) t FROM company_docs WHERE doc_date BETWEEN ? AND ? AND status='paid'", start, end).t;
  const obligationsR = one(`SELECT COALESCE(SUM(amount),0) t FROM obligations WHERE period_year IN (${yearsInRange.map(() => "?").join(",")})`, ...yearsInRange).t;
  const payrollR = one("SELECT COALESCE(SUM(total_employer_cost),0) t FROM payslips WHERE payment_date BETWEEN ? AND ?", start, end).t;
  const costByCat = d.prepare("SELECT category, SUM(amount) total FROM company_docs WHERE doc_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC").all(start, end) as any[];
  const overdueBills = one("SELECT COALESCE(SUM(amount),0) t FROM company_docs WHERE status='unpaid' AND due_date<?", today).t;
  const overdueObs = one(`SELECT COALESCE(SUM(amount),0) t FROM obligations WHERE status='unpaid' AND ${PAYABLE_SQL}<?`, today).t;
  const in30 = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const upBills = one("SELECT COALESCE(SUM(amount),0) t FROM company_docs WHERE status='unpaid' AND due_date>=? AND due_date<=?", today, in30).t;
  const upObs = one(`SELECT COALESCE(SUM(amount),0) t FROM obligations WHERE status='unpaid' AND ${PAYABLE_SQL}>=? AND ${PAYABLE_SQL}<=?`, today, in30).t;
  const kk = kontokorrentBalance();
  const recentInv = d.prepare("SELECT * FROM invoices WHERE hours>0 ORDER BY year DESC, month DESC LIMIT 12").all() as any[];
  const recentBills = d.prepare("SELECT * FROM company_docs ORDER BY doc_date DESC LIMIT 12").all() as any[];

  // monthly P&L for the calendar year the range ends in
  const plYear = Number(end.slice(0, 4));
  const plLastMonth = plYear === year ? now.getMonth() + 1 : 12;
  const byM = (sql: string, ...a: unknown[]) => {
    const m: Record<number, number> = {};
    for (const r of d.prepare(sql).all(...a) as any[]) m[Number(r.m)] = r.t;
    return m;
  };
  const invByM = byM("SELECT month m, SUM(subtotal) t FROM invoices WHERE hours>0 AND year=? GROUP BY month", plYear);
  const othByM = byM("SELECT CAST(substr(income_date,6,2) AS INTEGER) m, SUM(amount) t FROM income_entries WHERE invoice_id IS NULL AND substr(income_date,1,4)=? GROUP BY m", String(plYear));
  const billByM = byM("SELECT CAST(substr(doc_date,6,2) AS INTEGER) m, SUM(amount) t FROM company_docs WHERE substr(doc_date,1,4)=? AND category NOT IN ('Payroll Settlement', 'Taxes / VAT') GROUP BY m", String(plYear));
  const payByM = byM("SELECT CAST(substr(payment_date,6,2) AS INTEGER) m, SUM(total_employer_cost) t FROM payslips WHERE substr(payment_date,1,4)=? GROUP BY m", String(plYear));

  const obYear = one("SELECT COALESCE(SUM(amount),0) total, COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid, COUNT(*) n, SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) paid_n FROM obligations WHERE period_year=?", year);
  const obNext = one(`SELECT obligation_type, period_label, amount, expected_bill_amount, ${PAYABLE_SQL} due_date FROM obligations WHERE status='unpaid' AND ${PAYABLE_SQL}>=? ORDER BY ${PAYABLE_SQL} LIMIT 1`, today);
  const recv = one("SELECT COUNT(*) n, COALESCE(SUM(total),0) t, SUM(CASE WHEN due_date IS NOT NULL AND due_date<? THEN 1 ELSE 0 END) overdue_n FROM invoices WHERE hours>0 AND paid_status!='paid'", today);
  const billsOpen = one("SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM company_docs WHERE status='unpaid'");
  const psYear = one("SELECT COUNT(*) n, COALESCE(SUM(net_salary),0) net, COALESCE(SUM(total_employer_cost),0) cost FROM payslips WHERE year=?", year);
  const psLast = one("SELECT year, month, net_salary FROM payslips ORDER BY year DESC, month DESC LIMIT 1");
  const vatCollected = one("SELECT COALESCE(SUM(tax),0) t FROM invoices WHERE hours>0 AND year=?", year).t;
  const vatOpen = one("SELECT COALESCE(SUM(amount),0) t FROM obligations WHERE obligation_type='vat' AND status='unpaid'").t;
  const reservesSum = one("SELECT COUNT(*) n, COALESCE(SUM(target_amount),0) target FROM reserves WHERE is_active=1");
  const stmt = one("SELECT bank, period_end, closing_balance, currency FROM bank_statements ORDER BY period_end DESC LIMIT 1");

  const monthsCount = monthlyInv.length;
  const totalIncome = round2(invNet + otherIncome);
  const totalCosts = billsR + payrollR;
  const profit = round2(totalIncome - totalCosts);

  return {
    year,
    range: { key: rangeKey, label, start, end },
    income: { invoices_ytd: invStatsR.rev, invoiced_net_ytd: invNet, other_ytd: otherIncome,
      cash_received_ytd: cashReceived, invoices_paid_ytd: invPaidR, extra_ytd: cashReceived, total_ytd: totalIncome },
    costs: { bills_ytd: billsR, bills_paid_ytd: billsPaidR, payroll_ytd: payrollR,
      obligations_ytd: obligationsR, total_ytd: totalCosts,
      by_category: costByCat.map(r => ({ category: r.category, total: r.total })) },
    profit: { ytd: profit, margin_pct: totalIncome ? Math.round(profit / totalIncome * 1000) / 10 : 0 },
    invoices: { count_total: invStats.cnt, count_ytd: invStatsR.cnt, total_hours: invStats.hrs,
      hours_ytd: invStatsR.hrs,
      avg_monthly_revenue: round2(monthsCount ? invStats.rev / monthsCount : 0),
      avg_monthly_hours: monthsCount ? Math.round(invStats.hrs / monthsCount * 10) / 10 : 0 },
    upcoming: { overdue_total: round2(overdueBills + overdueObs), due_30d: round2(upBills + upObs) },
    transfers: { net_owed_to_personal: kk.net_owed_to_personal },
    monthly_series: monthlyInv.map(r => ({
      label: `${MONTH_ABBR[r.month]} ${r.year}`, year: r.year, month: r.month,
      revenue: r.revenue, hours: r.hours })),
    monthly_pl: Array.from({ length: plLastMonth }, (_, i) => {
      const m = i + 1;
      const income = round2((invByM[m] ?? 0) + (othByM[m] ?? 0));
      const costs = round2((billByM[m] ?? 0) + (payByM[m] ?? 0));
      return { label: MONTH_ABBR[m], year: plYear, month: m, income, costs,
        bills: round2(billByM[m] ?? 0), payroll: round2(payByM[m] ?? 0), profit: round2(income - costs) };
    }),
    panels: {
      receivables: { count: recv.n ?? 0, total: recv.t ?? 0, overdue_count: recv.overdue_n ?? 0 },
      bills: { count: billsOpen.n ?? 0, total: billsOpen.t ?? 0, overdue_total: overdueBills },
      obligations: { year, count: obYear.n ?? 0, paid_count: obYear.paid_n ?? 0,
        total: obYear.total ?? 0, paid: obYear.paid ?? 0,
        unpaid: round2((obYear.total ?? 0) - (obYear.paid ?? 0)), overdue_total: overdueObs,
        next: obNext.obligation_type ? { label: typeLabel(obNext.obligation_type),
          period: obNext.period_label, amount: obNext.expected_bill_amount || obNext.amount,
          due_date: obNext.due_date } : null },
      payroll: { payslips_year: psYear.n ?? 0, net_year: psYear.net ?? 0, cost_year: psYear.cost ?? 0,
        last_period: psLast.month ? `${MONTH_ABBR[psLast.month]} ${psLast.year}` : null,
        last_net: psLast.net_salary ?? null,
        months_missing: Math.max(0, now.getMonth() + 1 - (psYear.n ?? 0)) },
      vat: { collected_year: vatCollected, open_obligations: vatOpen },
      kontokorrent: { net: kk.net_owed_to_personal,
        personal_card_open: kk.personal_card_expenses, personal_card_open_count: kk.personal_card_open_count,
        reports_open: kk.expense_reports_outstanding, reports_open_count: kk.expense_reports_open_count },
      reserves: { count: reservesSum.n ?? 0, target: reservesSum.target ?? 0 },
      bank: stmt.bank ? { bank: stmt.bank, as_of: stmt.period_end, closing: stmt.closing_balance, currency: stmt.currency } : null,
    },
    recent_invoices: recentInv.map(r => ({
      id: r.id, invoice_number: r.invoice_number, month: r.month, year: r.year,
      month_name: MONTH_NAME[r.month], hours: r.hours, total: r.total,
      paid_status: r.paid_status ?? "unpaid", due_date: r.due_date })),
    recent_bills: recentBills.map(r => ({ id: r.id, vendor: r.vendor, amount: r.amount,
      currency: r.currency, category: r.category, doc_date: r.doc_date, status: r.status, due_date: r.due_date })),
  };
}
