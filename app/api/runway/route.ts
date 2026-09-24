import { guard, json } from "@/server/http";
import { db, round2, todayISO } from "@/server/db";
import { effectiveCash } from "@/server/cash";
import { payrollSettingsRow, rowToSettings, computePayslip } from "@/server/payroll";

// Port of routes/finance.py::compute_runway.
export const GET = guard(async () => {
  const d = db();
  const cash = effectiveCash();
  const recurring = d.prepare("SELECT amount, recurrence FROM company_docs WHERE recurrence IN ('monthly','quarterly','yearly') AND (parent_doc_id IS NULL OR parent_doc_id = 0)").all() as any[];
  const obs = d.prepare("SELECT amount, due_date FROM obligations WHERE status='unpaid' AND due_date IS NOT NULL").all() as any[];
  const sixAgo = new Date(Date.now() - 180 * 86400000);
  const avgKey = sixAgo.getFullYear() * 12 + sixAgo.getMonth() + 1;
  const avgInvoice = (d.prepare("SELECT COALESCE(AVG(total), 0) a FROM invoices WHERE hours > 0 AND year * 12 + month >= ?").get(avgKey) as any).a;

  let recurringMonthly = 0;
  for (const r of recurring) {
    if (r.recurrence === "monthly") recurringMonthly += r.amount;
    else if (r.recurrence === "quarterly") recurringMonthly += r.amount / 3;
    else recurringMonthly += r.amount / 12;
  }
  const horizon = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const ob12m = obs.filter(o => o.due_date <= horizon).reduce((s, o) => s + o.amount, 0);
  let payrollMonthly = 0;
  const psr = payrollSettingsRow();
  if (psr && psr.gross_monthly > 0) payrollMonthly = computePayslip(rowToSettings(psr)).total_employer_cost;
  const burn = round2(recurringMonthly + ob12m / 12 + payrollMonthly - avgInvoice);
  const months = burn <= 0 ? null : Math.round((cash.balance / burn) * 10) / 10;
  return json({
    balance: cash.balance, as_of: cash.as_of, monthly_burn: burn,
    monthly_recurring_cost: round2(recurringMonthly), monthly_obligations_cost: round2(ob12m / 12),
    monthly_payroll_cost: round2(payrollMonthly), monthly_expected_income: round2(avgInvoice),
    runway_months: months,
    description: months === null ? "Cash positive - no burn" : `${months.toFixed(1)} months at current burn`,
  });
});
