import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, todayISO } from "@/server/db";
import { lastDayOf, recomputeBalance } from "@/server/budget";

export const POST = guard(async (req: NextRequest, ctx: any) => {
  // Set the balance at end of a month via a dated correction entry.
  const { id } = await ctx.params;
  const body = await req.json();
  const targetBalance = Number(body.balance ?? 0);
  const monthStr: string = body.month || todayISO().slice(0, 7);
  const y = Number(monthStr.slice(0, 4)), m = Number(monthStr.slice(5, 7));
  const entryDate = `${monthStr}-${String(lastDayOf(y, m)).padStart(2, "0")}`;

  if (!db().prepare("SELECT id FROM budget_items WHERE id=?").get(Number(id))) return err(404, "Not found");
  const current = (db().prepare(
    "SELECT COALESCE(SUM(amount),0) as t FROM budget_ledger WHERE budget_item_id=? AND entry_date<=?"
  ).get(Number(id), entryDate) as any).t;
  const delta = targetBalance - current;
  if (Math.abs(delta) > 0.001) {
    db().prepare(
      "INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind) VALUES (?,?,?,?,?)"
    ).run(Number(id), entryDate, delta, `Balance set to ${targetBalance.toFixed(2)} for ${monthStr}`, "adjust");
  }
  return json({ balance: recomputeBalance(Number(id)), adjusted_for_month: monthStr });
});
