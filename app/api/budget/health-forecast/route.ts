import { guard, json } from "@/server/http";
import { db, round2, todayISO } from "@/server/db";

export const GET = guard(async () => {
  const today = todayISO();
  const [ty, tm] = today.split("-").map(Number);
  const items: any[] = db().prepare("SELECT * FROM budget_items ORDER BY grp, sort_order").all();
  const futureBills: any[] = db().prepare(
    `SELECT * FROM company_docs
     WHERE status='unpaid' AND due_date IS NOT NULL AND due_date >= ? ORDER BY due_date`).all(today);

  const results = items.map(it => {
    const balance = it.balance || 0;
    const monthly = it.budgeted || 0;
    const subLower = String(it.subcategory).toLowerCase();

    let upcoming: any = null;
    for (const b of futureBills) {
      const vendorLower = (b.vendor || "").toLowerCase();
      const descLower = (b.description || "").toLowerCase();
      const catLower = (b.category || "").toLowerCase();
      if (vendorLower.includes(subLower) || subLower.includes(vendorLower)
          || descLower.includes(subLower) || catLower.includes(subLower)) {
        upcoming = b;
        break;
      }
    }

    let status = "healthy";
    let message = `Reserve grows by ${monthly.toFixed(0)}/mo`;
    if (upcoming) {
      const [dy, dm] = String(upcoming.due_date).split("-").map(Number);
      const monthsUntil = Math.max(0, (dy - ty) * 12 + (dm - tm));
      const gap = balance + monthly * monthsUntil - upcoming.amount;
      if (gap >= 0) {
        message = `Will cover ${upcoming.vendor} (${upcoming.amount.toFixed(0)}) due ${upcoming.due_date}`;
      } else {
        status = "shortfall";
        message = `SHORTFALL of ${Math.abs(gap).toFixed(0)} by ${upcoming.due_date} vs ${upcoming.vendor}`;
      }
    }

    return {
      id: it.id, subcategory: it.subcategory, grp: it.grp,
      current_balance: balance, monthly_contribution: monthly,
      projected_12m: round2(balance + monthly * 12),
      status, message,
      next_expense: upcoming
        ? { vendor: upcoming.vendor, amount: upcoming.amount, due_date: upcoming.due_date }
        : null,
    };
  });
  return json({ items: results });
});
