import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db, MONTH_NAME } from "@/server/db";
import { SALARY, BUDGET_GROUPS } from "@/server/budget";

// company_docs categories → budget groups
const CAT_TO_GROUP: Record<string, string> = {
  "Office Supplies": "business_variable",
  "Software/Subscriptions": "business_fixed",
  "Professional Services": "business_variable",
  "Insurance": "personal_fixed",
  "Rent": "personal_fixed",
  "Telecom": "personal_fixed",
  "Legal": "business_variable",
  "Bank Fees": "business_fixed",
  "Other": "business_variable",
};

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const p = await ctx.params;
  const year = Number(p.year), month = Number(p.month);
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  const budgetRows: any[] = db().prepare("SELECT * FROM budget_items ORDER BY grp, sort_order").all();
  const invoiceIncome = (db().prepare(
    "SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE year=? AND month=? AND hours>0").get(year, month) as any).total;
  const extraIncome = (db().prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM income_entries WHERE substr(income_date,1,7)=?").get(monthStr) as any).total;
  const docs: any[] = db().prepare("SELECT * FROM company_docs WHERE substr(doc_date,1,7)=?").all(monthStr);
  const expenses: any[] = db().prepare("SELECT * FROM expenses WHERE substr(expense_date,1,7)=?").all(monthStr);
  const reimbursed = (db().prepare(
    "SELECT COALESCE(SUM(total),0) as t FROM invoices WHERE year=? AND month=? AND hours=0").get(year, month) as any).t;

  const groupActuals: Record<string, number> = Object.fromEntries(Object.keys(BUDGET_GROUPS).map(g => [g, 0]));
  const docTransactions = docs.map(d => {
    const grp = CAT_TO_GROUP[d.category] ?? "business_variable";
    groupActuals[grp] += d.amount;
    return { date: d.doc_date, vendor: d.vendor, description: d.description,
      amount: d.amount, currency: d.currency, category: d.category, group: grp };
  });

  // Travel expenses are REIMBURSABLE client costs — visibility only, never
  // part of the GmbH operating budget actuals.
  const travelTotal = expenses.reduce((s, e) => s + e.amount, 0);

  const budgetItems: Record<string, { subcategory: string; budgeted: number }[]> = {};
  for (const r of budgetRows) {
    (budgetItems[r.grp] ??= []).push({ subcategory: r.subcategory, budgeted: r.budgeted });
  }

  const totalIncome = SALARY + invoiceIncome + extraIncome;
  const totalBudgeted = budgetRows.reduce((s, r) => s + r.budgeted, 0);
  const totalActual = Object.values(groupActuals).reduce((s, v) => s + v, 0);

  const groupsSummary = Object.entries(BUDGET_GROUPS).map(([key, label]) => {
    const budgeted = (budgetItems[key] ?? []).reduce((s, it) => s + it.budgeted, 0);
    const actual = groupActuals[key];
    return { key, label, budgeted, actual, diff: budgeted - actual, items: budgetItems[key] ?? [] };
  });

  return json({
    year, month,
    month_name: MONTH_NAME[month],
    salary: SALARY,
    invoice_income: invoiceIncome,
    extra_income: extraIncome,
    total_income: totalIncome,
    total_budgeted: totalBudgeted,
    total_actual: totalActual,
    left_to_budget: totalIncome - totalBudgeted,
    left_to_spend: totalIncome - totalActual,
    groups: groupsSummary,
    transactions: docTransactions,
    travel_total: travelTotal,
    travel_count: expenses.length,
    travel_reimbursed_this_month: reimbursed,
    travel_isolation_note: "Travel expenses are reimbursable client costs and excluded from the GmbH budget actuals.",
  });
});
