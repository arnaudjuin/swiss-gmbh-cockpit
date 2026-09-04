import { guard, json } from "@/server/http";
import { db, round2 } from "@/server/db";

function monthsElapsed(startIso: string | null): number {
  if (!startIso) return 0;
  const [y, m] = startIso.split("-").map(Number);
  if (!y || !m) return 0;
  const now = new Date();
  const diff = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m) + 1;
  return Math.max(0, diff);
}

export const GET = guard(async () => {
  const rows = db().prepare("SELECT * FROM reserves WHERE is_active=1 ORDER BY target_date").all() as any[];
  return json(rows.map(r => {
    const accrued = round2(monthsElapsed(r.accrual_start) * (r.monthly_accrual || 0) + (r.accumulated_manual || 0));
    const target = r.target_amount || 0;
    return {
      id: r.id, name: r.name, purpose: r.purpose,
      target_amount: target, target_date: r.target_date,
      monthly_accrual: r.monthly_accrual, accrual_start: r.accrual_start,
      accumulated_manual: r.accumulated_manual, accumulated: accrued,
      remaining: round2(Math.max(0, target - accrued)),
      progress_pct: Math.min(target ? Math.round(1000 * accrued / target) / 10 : 0, 100),
      is_active: !!r.is_active,
    };
  }));
});
