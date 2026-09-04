import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { reserveToDict } from "@/server/reserves";

export const GET = guard(async () => {
  const rows = db().prepare("SELECT * FROM reserves WHERE is_active=1 ORDER BY target_date").all() as any[];
  return json(rows.map(reserveToDict));
});

export const POST = guard(async (req: NextRequest) => {
  const form = await req.formData();
  const s = (k: string, d = "") => { const v = form.get(k); return typeof v === "string" ? v : d; };
  const num = (k: string, d = 0) => { const v = s(k); return v.trim() === "" ? d : Number(v); };
  const cur = db().prepare(
    `INSERT INTO reserves
       (name, purpose, target_amount, target_date, monthly_accrual,
        accrual_start, accumulated_manual)
     VALUES (?,?,?,?,?,?,?)`
  ).run(s("name"), s("purpose"), num("target_amount"), s("target_date") || null,
    num("monthly_accrual"), s("accrual_start") || null, num("accumulated_manual"));
  return json({ id: Number(cur.lastInsertRowid) });
});
