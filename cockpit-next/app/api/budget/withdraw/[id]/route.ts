import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db, todayISO } from "@/server/db";
import { recomputeBalance } from "@/server/budget";

export const POST = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const amount = Number(body.amount ?? 0);
  if (!(amount > 0)) return err(400, "Amount must be positive");
  if (!db().prepare("SELECT * FROM budget_items WHERE id=?").get(Number(id)))
    return err(404, "Budget item not found");
  db().prepare(
    "INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind) VALUES (?,?,?,?,?)"
  ).run(Number(id), body.date || todayISO(), -amount, body.description || "Manual withdrawal", "withdraw");
  return json({ balance: recomputeBalance(Number(id)) });
});
