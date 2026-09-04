import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

export const GET = guard(async (_req: NextRequest, ctx: any) => {
  const { id } = await ctx.params;
  if (!db().prepare("SELECT 1 FROM trips WHERE id=?").get(Number(id))) return err(404, "Trip not found");
  const rows: any[] = db().prepare(
    `SELECT id, expense_date, description, amount, category,
       original_amount, original_currency, scan_file
     FROM expenses WHERE trip_id=? ORDER BY expense_date, id`).all(Number(id));
  return json(rows.map(r => ({
    id: r.id, expense_date: r.expense_date, description: r.description,
    amount: r.amount, category: r.category, original_amount: r.original_amount,
    original_currency: r.original_currency, scan_file: r.scan_file,
    has_scan: r.scan_file != null,
  })));
});
