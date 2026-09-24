import { guard, json } from "@/server/http";
import { db, todayISO } from "@/server/db";
import { PAYABLE_SQL, typeLabel } from "@/server/obligations";

export const GET = guard(async () => {
  const d = db();
  const today = todayISO();
  const year = new Date().getFullYear();
  const cutoff = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const rows = d.prepare("SELECT obligation_type, SUM(amount) total, SUM(CASE WHEN status='unpaid' THEN amount ELSE 0 END) unpaid FROM obligations WHERE period_year=? GROUP BY obligation_type").all(year) as any[];
  const dict = (r: any) => ({ id: r.id, obligation_type: r.obligation_type,
    type_label: typeLabel(r.obligation_type), period_label: r.period_label,
    amount: r.amount, currency: r.currency, due_date: r.due_date,
    status: r.status, notes: r.notes ?? "" });
  const upcoming = d.prepare(`SELECT * FROM obligations WHERE status='unpaid' AND due_date IS NOT NULL AND ${PAYABLE_SQL} >= ? AND ${PAYABLE_SQL} <= ? ORDER BY ${PAYABLE_SQL}`).all(today, cutoff) as any[];
  const overdue = d.prepare(`SELECT * FROM obligations WHERE status='unpaid' AND ${PAYABLE_SQL} < ? ORDER BY ${PAYABLE_SQL}`).all(today) as any[];
  const byType = rows.map(r => ({ obligation_type: r.obligation_type,
    type_label: typeLabel(r.obligation_type), total_ytd: r.total, unpaid: r.unpaid }));
  return json({ year, by_type: byType,
    total_ytd: byType.reduce((s, r) => s + r.total_ytd, 0),
    total_unpaid: byType.reduce((s, r) => s + r.unpaid, 0),
    upcoming_90d: upcoming.map(dict), overdue: overdue.map(dict) });
});
