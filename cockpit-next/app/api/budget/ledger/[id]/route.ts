import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";
import { recomputeBalance } from "@/server/budget";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;   // item id
  const rows: any[] = db().prepare(
    "SELECT * FROM budget_ledger WHERE budget_item_id=? ORDER BY entry_date DESC, id DESC LIMIT 100"
  ).all(Number(id));
  return json(rows.map(r => ({
    id: r.id, entry_date: r.entry_date, amount: r.amount,
    description: r.description, kind: r.kind,
  })));
});

export const DELETE = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;   // ledger entry id
  const row: any = db().prepare("SELECT * FROM budget_ledger WHERE id=?").get(Number(id));
  if (!row) return err(404, "Entry not found");
  const snapshot = {
    budget_item_id: row.budget_item_id, entry_date: row.entry_date,
    amount: row.amount, description: row.description, kind: row.kind,
  };
  db().prepare("DELETE FROM budget_ledger WHERE id=?").run(Number(id));
  return json({ message: "Entry revoked", balance: recomputeBalance(row.budget_item_id), snapshot });
});

export const PUT = guard(async (req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;   // ledger entry id
  const body = await req.json();
  const row: any = db().prepare("SELECT * FROM budget_ledger WHERE id=?").get(Number(id));
  if (!row) return err(404, "Entry not found");
  db().prepare("UPDATE budget_ledger SET amount=?, description=?, entry_date=? WHERE id=?").run(
    body.amount != null ? Number(body.amount) : row.amount,
    body.description != null ? body.description : row.description,
    body.entry_date || row.entry_date,
    Number(id));
  return json({ message: "Entry updated", balance: recomputeBalance(row.budget_item_id) });
});
