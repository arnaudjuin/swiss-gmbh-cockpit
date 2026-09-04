import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, todayISO } from "@/server/db";
import { lastDayOf, recomputeBalance } from "@/server/budget";

export const POST = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const amountOverride = body.amount;
  const monthStr: string = body.month || todayISO().slice(0, 7);
  const y = Number(monthStr.slice(0, 4)), m = Number(monthStr.slice(5, 7));
  const entryDate = `${monthStr}-${String(lastDayOf(y, m)).padStart(2, "0")}`;

  const row: any = db().prepare("SELECT * FROM budget_items WHERE id=?").get(Number(id));
  if (!row) return err(404, "Budget item not found");
  const exists = db().prepare(
    "SELECT id FROM budget_ledger WHERE budget_item_id=? AND kind='contribute' AND substr(entry_date,1,7)=?"
  ).get(Number(id), monthStr);
  if (exists && amountOverride == null) return err(400, `Already contributed for ${monthStr}`);

  const amount = amountOverride != null ? Number(amountOverride) : row.budgeted;
  db().prepare(
    "INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind) VALUES (?,?,?,?,?)"
  ).run(Number(id), entryDate, amount, `Monthly contribution for ${monthStr}`, "contribute");
  const newBalance = recomputeBalance(Number(id));
  db().prepare("UPDATE budget_items SET last_contributed_month=? WHERE id=?").run(monthStr, Number(id));
  return json({ balance: newBalance, amount, month: monthStr });
});
