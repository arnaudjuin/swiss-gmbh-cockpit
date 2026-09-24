// Budget module shared bits — port of routes/budget.py module scope.
import { db } from "./db";

export const SALARY = 13000.00;  // Monthly salary (app.py constant, referenced by budget + reports)

export const BUDGET_GROUPS: Record<string, string> = {
  personal_fixed: "Personal Fixed",
  business_fixed: "Business Fixed",
  debt: "Debt",
  needs: "Needs",
  wants: "Wants",
  business_variable: "Business Variable",
  savings: "Savings",
};

export const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function recomputeBalance(itemId: number): number {
  const t = (db().prepare(
    "SELECT COALESCE(SUM(amount),0) as t FROM budget_ledger WHERE budget_item_id=?").get(itemId) as any).t;
  db().prepare("UPDATE budget_items SET balance=? WHERE id=?").run(t, itemId);
  return t;
}
