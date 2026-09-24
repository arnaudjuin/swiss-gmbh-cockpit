import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { recomputeBalance } from "@/server/budget";

export const POST = guard(async (req: NextRequest) => {
  // Re-create a ledger entry from a snapshot (undo).
  const body = await req.json();
  for (const field of ["budget_item_id", "entry_date", "amount"]) {
    if (!(field in body)) return err(400, `Missing required field: ${field}`);
  }
  if (!db().prepare("SELECT id FROM budget_items WHERE id=?").get(body.budget_item_id))
    return err(404, "Budget item not found");
  const cur = db().prepare(
    "INSERT INTO budget_ledger (budget_item_id, entry_date, amount, description, kind) VALUES (?,?,?,?,?)"
  ).run(body.budget_item_id, body.entry_date, body.amount, body.description ?? "", body.kind ?? "adjust");
  return json({ id: Number(cur.lastInsertRowid), balance: recomputeBalance(body.budget_item_id) });
});
