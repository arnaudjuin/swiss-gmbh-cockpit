import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, todayISO } from "@/server/db";
import { lastDayOf } from "@/server/budget";

export const GET = guard(async (req: NextRequest) => {
  // Balances computed from the ledger as of end of the selected month.
  const currentMonth = todayISO().slice(0, 7);
  const selected = req.nextUrl.searchParams.get("month") || currentMonth;
  const y = Number(selected.slice(0, 4)), m = Number(selected.slice(5, 7));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !y || !m)
    return err(400, "month must be YYYY-MM");
  const endOfMonth = `${selected}-${String(lastDayOf(y, m)).padStart(2, "0")}`;

  const items: any[] = db().prepare("SELECT * FROM budget_items ORDER BY grp, sort_order").all();
  const sums = (sql: string, ...args: unknown[]) =>
    new Map<number, number>((db().prepare(sql).all(...args) as any[]).map(r => [r.budget_item_id, r.total]));
  const current = sums("SELECT budget_item_id, COALESCE(SUM(amount),0) as total FROM budget_ledger GROUP BY budget_item_id");
  const atEnd = sums("SELECT budget_item_id, COALESCE(SUM(amount),0) as total FROM budget_ledger WHERE entry_date<=? GROUP BY budget_item_id", endOfMonth);
  const contrib = sums("SELECT budget_item_id, COALESCE(SUM(amount),0) as total FROM budget_ledger WHERE kind='contribute' AND substr(entry_date,1,7)=? GROUP BY budget_item_id", selected);
  const withdrew = sums("SELECT budget_item_id, COALESCE(SUM(amount),0) as total FROM budget_ledger WHERE kind='withdraw' AND substr(entry_date,1,7)=? GROUP BY budget_item_id", selected);

  return json({
    current_month: currentMonth,
    selected_month: selected,
    items: items.map(r => ({
      id: r.id, grp: r.grp, subcategory: r.subcategory, budgeted: r.budgeted,
      balance_current: current.get(r.id) ?? 0,
      balance_at_month_end: atEnd.get(r.id) ?? 0,
      contributed_in_month: (contrib.get(r.id) ?? 0) > 0,
      contributed_amount_in_month: contrib.get(r.id) ?? 0,
      withdrawn_amount_in_month: -(withdrew.get(r.id) ?? 0),   // flip sign to positive
    })),
  });
});
