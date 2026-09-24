import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { db } from "@/server/db";

export const PUT = guard(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const f = await req.formData();
  if (!db().prepare("SELECT 1 FROM reserves WHERE id=?").get(id)) return err(404, "Reserve not found");
  db().prepare(`UPDATE reserves SET name=?, purpose=?, target_amount=?, target_date=?,
    monthly_accrual=?, accrual_start=?, accumulated_manual=?, is_active=?, updated_at=datetime('now') WHERE id=?`)
    .run(String(f.get("name")), String(f.get("purpose") ?? ""), Number(f.get("target_amount")),
      String(f.get("target_date") ?? "") || null, Number(f.get("monthly_accrual") ?? 0),
      String(f.get("accrual_start") ?? "") || null, Number(f.get("accumulated_manual") ?? 0),
      Number(f.get("is_active") ?? 1), id);
  return json({ message: "Reserve updated" });
});

export const DELETE = guard(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!db().prepare("SELECT 1 FROM reserves WHERE id=?").get(id)) return err(404, "Reserve not found");
  db().prepare("DELETE FROM reserve_ledger WHERE reserve_id=?").run(id);
  db().prepare("DELETE FROM reserves WHERE id=?").run(id);
  return json({ message: "Reserve deleted" });
});
