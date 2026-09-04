import { guard, json } from "@/server/http";
import { db, round2 } from "@/server/db";
import { reserveToDict } from "@/server/reserves";

export const GET = guard(async () => {
  const items = (db().prepare("SELECT * FROM reserves WHERE is_active=1").all() as any[]).map(reserveToDict);
  return json({
    count: items.length,
    target_total: round2(items.reduce((s, i) => s + i.target_amount, 0)),
    accumulated_total: round2(items.reduce((s, i) => s + i.accumulated, 0)),
    monthly_accrual_total: round2(items.reduce((s, i) => s + i.monthly_accrual, 0)),
  });
});
