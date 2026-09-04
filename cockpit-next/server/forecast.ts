// Port of routes/finance.py::finance_forecast — per-calendar-year cash rows
// plus the expected accrual P&L block. Same rules, same preferences fallback.
import { db, round2, addMonths, MONTH_ABBR, todayISO } from "./db";
import { PAYABLE_SQL, typeLabel } from "./obligations";
import { prefPath } from "./prefs";
import { payrollSettingsRow, rowToSettings, computePayslip } from "./payroll";
import { effectiveCash } from "./cash";

interface Item { label: string; amount: number; date: string; kind: string }

export function financeForecast(yearParam?: number, incomeParam?: number, incomesParam?: string) {
  const d = db();
  const today = todayISO();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const year = Math.max(now.getFullYear(), Math.min(now.getFullYear() + 5, yearParam ?? now.getFullYear()));
  const horizonEnd = `${year + 1}-01-01`;
  const months = (year - now.getFullYear()) * 12 + (12 - now.getMonth());
  const one = (sql: string, ...a: unknown[]) => (d.prepare(sql).get(...a) as any) ?? {};

  const cash = effectiveCash();
  const opening = cash.balance ?? 0;

  const sixAgo = addMonths(monthStart, -6);
  const avgRow = one(
    "SELECT COALESCE(AVG(t),0) a, COUNT(*) n FROM (SELECT SUM(total) t FROM invoices WHERE hours>0 AND (year*12+month) >= ? GROUP BY year, month)",
    Number(sixAgo.slice(0, 4)) * 12 + Number(sixAgo.slice(5, 7)));
  const avgIncome = round2(avgRow.a ?? 0);
  const incomeM = incomeParam ?? avgIncome;
  const incomeSource = incomeParam != null ? "override" : `avg of last ${avgRow.n} invoiced months`;

  let netSalary = 0, empStart: string | null = null, calc: any = null;
  const psr = payrollSettingsRow();
  if (psr && psr.gross_monthly > 0) {
    calc = computePayslip(rowToSettings(psr));
    netSalary = calc.net_salary;
    empStart = psr.employment_start ?? null;
  }

  const pots = d.prepare("SELECT name, monthly_accrual, accrual_start, target_date FROM reserves WHERE is_active=1 AND monthly_accrual > 0").all() as any[];
  const potsFundFuture = pots.length > 0;
  const yearEnd = `${now.getFullYear()}-12-31`;

  const perMonthIncome: Record<string, number> = {};
  if (incomesParam == null) {
    const saved = prefPath<Record<string, unknown>>("forecast.incomeByMonth", {}) || {};
    for (const [k, v] of Object.entries(saved)) {
      const n = Number(v); if (Number.isFinite(n) && String(v).trim() !== "") perMonthIncome[k] = n;
    }
  } else {
    for (const tok of incomesParam.split(",")) {
      const i = tok.indexOf(":");
      if (i > 0) { const n = Number(tok.slice(i + 1)); if (Number.isFinite(n)) perMonthIncome[tok.slice(0, i).trim()] = n; }
    }
  }

  const buckets: Record<string, { obligations: number; bills: number; items: Item[] }> = {};
  const add = (dateIso: string, kind: "obligations" | "bills", amount: number, label: string) => {
    if (dateIso >= horizonEnd) return;
    const clamped = dateIso < monthStart ? monthStart : dateIso;   // bucket month
    const key = clamped.slice(0, 7);
    const b = (buckets[key] ??= { obligations: 0, bills: 0, items: [] });
    b[kind] += amount;
    b.items.push({ label, amount: round2(amount), date: dateIso, kind });  // original date shown
  };

  for (const o of d.prepare("SELECT * FROM obligations WHERE status='unpaid' AND due_date IS NOT NULL").all() as any[]) {
    const exp = o.expected_bill_date ?? null;
    const payable = exp && exp > o.due_date ? exp : o.due_date;
    if (potsFundFuture && payable > yearEnd) continue;   // funded by the pots
    add(payable, "obligations", o.expected_bill_amount || o.amount,
      `${typeLabel(o.obligation_type)} — ${o.period_label}`);
  }
  for (const b of d.prepare("SELECT * FROM company_docs WHERE status='unpaid'").all() as any[]) {
    add(b.due_date ?? b.doc_date, "bills", b.amount, b.vendor);
  }
  for (const t of d.prepare("SELECT * FROM company_docs WHERE recurrence IN ('monthly','quarterly','yearly') AND (parent_doc_id IS NULL OR parent_doc_id = 0)").all() as any[]) {
    const latest = one("SELECT COALESCE(due_date, doc_date) d FROM company_docs WHERE id=? OR parent_doc_id=? ORDER BY d DESC LIMIT 1", t.id, t.id).d;
    const step = { monthly: 1, quarterly: 3, yearly: 12 }[t.recurrence as "monthly"] ?? 12;
    let cur = latest as string;
    for (let i = 0; i < 36; i++) {
      cur = addMonths(cur, step);
      if (cur >= horizonEnd) break;
      if (cur < monthStart) continue;
      add(cur, "bills", t.amount, `${t.vendor} (recurring)`);
    }
  }

  const rows: any[] = [];
  let cashBal = opening, yearOpen = opening, lowest: any = null;
  for (let i = 0; i < months; i++) {
    const mIso = addMonths(monthStart, i);
    const key = mIso.slice(0, 7);
    const mYear = Number(key.slice(0, 4)), mNo = Number(key.slice(5, 7));
    const b = buckets[key] ?? { obligations: 0, bills: 0, items: [] };
    const pay = netSalary && (!empStart || mIso >= `${empStart.slice(0, 7)}-01`) ? netSalary : 0;
    let res = 0; const resItems: Item[] = [];
    for (const pot of pots) {
      const s = pot.accrual_start ? `${pot.accrual_start.slice(0, 7)}-01` : monthStart;
      const e = pot.target_date ? `${pot.target_date.slice(0, 7)}-01` : null;
      if (mIso >= s && (!e || mIso <= e)) {
        res += pot.monthly_accrual;
        resItems.push({ label: `${pot.name} (pot)`, amount: round2(pot.monthly_accrual), date: key, kind: "reserves" });
      }
    }
    const inc = perMonthIncome[key] ?? incomeM;
    const out = round2(pay + b.obligations + b.bills + res);
    const net = round2(inc - out);
    cashBal = round2(cashBal + net);
    const row = { key, label: `${MONTH_ABBR[mNo]} ${mYear}`, income: round2(inc),
      income_override: key in perMonthIncome,
      payroll_net: round2(pay), obligations: round2(b.obligations), bills: round2(b.bills),
      reserves: round2(res), out, net, cash_end: cashBal, items: [...b.items, ...resItems] };
    if (mYear !== year) { yearOpen = cashBal; continue; }
    rows.push(row);
    if (!lowest || cashBal < lowest.cash_end) lowest = row;
  }

  // ── expected accrual P&L ──
  const VAT = 0.081;
  const invNetY = one("SELECT COALESCE(SUM(subtotal),0) t FROM invoices WHERE hours>0 AND year=?", year).t;
  const invMonths = new Set((d.prepare("SELECT DISTINCT month FROM invoices WHERE hours>0 AND year=?").all(year) as any[]).map(r => r.month));
  const otherY = one("SELECT COALESCE(SUM(amount),0) t FROM income_entries WHERE invoice_id IS NULL AND substr(income_date,1,4)=?", String(year)).t;
  const payRows = one("SELECT COALESCE(SUM(total_employer_cost),0) t, COUNT(*) n, COALESCE(MAX(month),0) last FROM payslips WHERE year=?", year);
  const billsY = one("SELECT COALESCE(SUM(amount),0) t FROM company_docs WHERE substr(doc_date,1,4)=? AND category NOT IN ('Payroll Settlement', 'Taxes / VAT')", String(year)).t;
  const fiduciary = one("SELECT COALESCE(SUM(amount),0) t FROM obligations WHERE obligation_type='accounting' AND period_year=?", year).t;

  let projRevNet = 0; const projMonths: string[] = [];
  for (const r of rows) {
    const mNo = Number(r.key.slice(5, 7));
    if (invMonths.has(mNo)) continue;
    projRevNet += r.income / (1 + VAT);
    projMonths.push(r.label);
  }
  let payrollProjMonths = 0;
  if (netSalary && year >= now.getFullYear()) {
    const first = Math.max((payRows.last ?? 0) + 1,
      empStart && Number(empStart.slice(0, 4)) === year ? Number(empStart.slice(5, 7)) : 1);
    payrollProjMonths = year === now.getFullYear() ? Math.max(0, 12 - first + 1) : (year > now.getFullYear() ? 12 : 0);
  }
  const payrollProj = payrollProjMonths && calc ? payrollProjMonths * calc.total_employer_cost : 0;
  const monthsWithBills = year === now.getFullYear() ? Math.max(1, Math.min(12, now.getMonth() + 1)) : 12;
  const billsProj = year === now.getFullYear() ? (billsY / monthsWithBills) * Math.max(0, 12 - monthsWithBills) : 0;

  const pbt = round2(invNetY + otherY + projRevNet - payRows.t - payrollProj - billsY - billsProj - fiduciary);
  const estTax = round2(Math.max(0, pbt) * 0.165);
  const legalReserve = round2(Math.max(0, pbt - estTax) * 0.05);

  return {
    pl: {
      year, revenue_actual_net: round2(invNetY + otherY), revenue_projected_net: round2(projRevNet),
      projected_months: projMonths,
      payroll_actual: round2(payRows.t), payroll_projected: round2(payrollProj),
      bills_actual: round2(billsY), bills_projected: round2(billsProj),
      fiduciary_accrual: round2(fiduciary),
      profit_before_tax: pbt, est_corporate_tax: estTax, legal_reserve: legalReserve,
      est_distributable: round2(Math.max(0, pbt - estTax - legalReserve)),
      note: "Accrual estimate: entered incomes treated as incl. VAT; payroll at current settings; " +
        "bills at the year's run rate; fiduciary fee accrued into this year. The signed closing decides.",
    },
    opening: yearOpen, bank_balance: opening, as_of: cash.as_of, source: cash.source,
    income_monthly: round2(incomeM), income_source: incomeSource, avg_income: avgIncome,
    payroll_net: round2(netSalary),
    pots: pots.map(p => ({ name: p.name, monthly_accrual: p.monthly_accrual })),
    pots_fund_after: potsFundFuture ? yearEnd : null,
    carried_from: year === now.getFullYear() ? null : `${MONTH_ABBR[now.getMonth() + 1]} ${now.getFullYear()}`,
    year, end_cash: cashBal,
    lowest: lowest ? { label: lowest.label, cash_end: lowest.cash_end } : null,
    horizon_months: rows.length,
    months: rows,
  };
}
